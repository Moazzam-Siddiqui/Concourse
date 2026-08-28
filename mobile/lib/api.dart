import 'dart:convert';

import 'package:http/http.dart' as http;

/// Every call this app makes, and nothing else.
///
/// Five endpoints, one shared [http.Client] so keep-alive is amortised across them. Transport
/// failure is normalised the same way `frontend/src/api.js` does it: `status == 0` with a
/// message that says the backend is unreachable, rather than surfacing a bare socket error that
/// tells a user nothing they can act on.
class ApiError implements Exception {
  ApiError(this.status, this.message);
  final int status;
  final String message;

  @override
  String toString() => message;
}

/// Where a fix put the attendee. Mirrors the backend's `WalkerPlacement`.
class Placement {
  const Placement({
    required this.state,
    this.nodeId,
    this.x,
    this.y,
    this.accuracyVenueUnits,
  });

  /// IN_ZONE · MANUAL · IN_TRANSIT · OUTSIDE_VENUE · TOO_INACCURATE
  final String state;
  final String? nodeId;
  final double? x;
  final double? y;
  final double? accuracyVenueUnits;

  bool get counts => state == 'IN_ZONE' || state == 'MANUAL';

  /// True only when the server placed us somewhere it is willing to stand behind.
  ///
  /// The app draws a dot if and only if this is true. Every other state means "we do not know
  /// where you are", and inventing a position for those is the one thing this UI must not do.
  bool get hasPosition => counts && x != null && y != null;

  factory Placement.fromJson(Map<String, dynamic> json) => Placement(
        state: json['state'] as String,
        nodeId: json['nodeId'] as String?,
        x: (json['x'] as num?)?.toDouble(),
        y: (json['y'] as num?)?.toDouble(),
        accuracyVenueUnits: (json['accuracyVenueUnits'] as num?)?.toDouble(),
      );
}

class ConcourseApi {
  ConcourseApi({required this.baseUrl, http.Client? client})
      : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;

  Future<Map<String, dynamic>> getSession(String sessionId) async =>
      await _getJson('/sessions/$sessionId') as Map<String, dynamic>;

  Future<List<dynamic>> listSessions() async => await _getJson('/sessions') as List<dynamic>;

  Future<Map<String, dynamic>> getVenue(String venueId) async =>
      await _getJson('/venues/$venueId') as Map<String, dynamic>;

  /// `people=false`: this app never draws other attendees, so their positions would be tens of
  /// kilobytes per poll of data it is not allowed to show.
  Future<Map<String, dynamic>> getState(String sessionId) async =>
      await _getJson('/sessions/$sessionId/state?people=false') as Map<String, dynamic>;

  /// The walking route to the nearest exit, over the venue's own edges. Same endpoint the web
  /// Walker uses — the Dijkstra runs server-side and this app does not reimplement it.
  Future<Map<String, dynamic>> getRoute(String venueId, String fromNodeId) async =>
      await _getJson('/venues/$venueId/route?from=$fromNodeId') as Map<String, dynamic>;

  /// Whether this venue can resolve GPS at all. A 404 is the ordinary answer, not an error.
  Future<bool> hasGeoref(String venueId) async {
    try {
      await _getJson('/venues/$venueId/georef');
      return true;
    } on ApiError catch (e) {
      if (e.status == 404) return false;
      rethrow;
    }
  }

  Future<Placement> sendFix(String sessionId, String walkerId, Map<String, dynamic> body) async {
    final response = await _send('PUT', '/sessions/$sessionId/walkers/$walkerId', body);
    return Placement.fromJson(jsonDecode(response) as Map<String, dynamic>);
  }

  /// Best-effort: called on the way out, when there is nobody left to report a failure to.
  Future<void> leave(String sessionId, String walkerId) async {
    try {
      await _send('DELETE', '/sessions/$sessionId/walkers/$walkerId', null);
    } on ApiError {
      // The TTL will clear us within 30 seconds anyway.
    }
  }

  Future<dynamic> _getJson(String path) async => jsonDecode(await _send('GET', path, null));

  Future<String> _send(String method, String path, Map<String, dynamic>? body) async {
    final uri = Uri.parse('$baseUrl$path');
    final request = http.Request(method, uri);
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    http.Response response;
    try {
      response = await http.Response.fromStream(await _client.send(request))
          .timeout(const Duration(seconds: 10));
    } catch (cause) {
      // Only transport failures land here, which in practice means the backend is not running
      // or the phone has no network. Say that, rather than surfacing a socket exception.
      throw ApiError(0, 'Cannot reach the venue at $baseUrl. Are you online?');
    }

    if (response.statusCode >= 400) {
      throw ApiError(response.statusCode, _messageFrom(response));
    }
    return response.body;
  }

  /// Unwraps Spring's `ApiError` body, falling back to something that at least names the call.
  String _messageFrom(http.Response response) {
    try {
      final body = jsonDecode(response.body);
      if (body is Map && body['message'] is String) return body['message'] as String;
    } catch (_) {
      // Not JSON. Fall through.
    }
    return '${response.request?.method} ${response.request?.url.path} → ${response.statusCode}';
  }

  void close() => _client.close();
}
