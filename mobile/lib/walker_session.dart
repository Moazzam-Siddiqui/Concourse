import 'dart:async';

// widgets.dart, not foundation.dart: ChangeNotifier lives in foundation, but the lifecycle
// hooks this class needs — WidgetsBinding, WidgetsBindingObserver, AppLifecycleState — do
// not. widgets.dart re-exports foundation, so this is a superset.
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';

import 'api.dart';
import 'location_gate.dart';
import 'map_projection.dart';

/// How the app is deciding where the attendee is.
enum PositionMode {
  /// Streaming fixes from the device.
  gps,

  /// Tapping a zone, exactly as the web Walker has always worked. Not a degraded stub — it is
  /// the same feature with a different sensor, and it is the only mode most venues will offer.
  manual,
}

/// Why the app is in manual mode, when it is. Shown to the attendee verbatim.
enum ManualReason {
  none,
  venueNotGeoreferenced,
  permissionDenied,
  permissionDeniedForever,
  locationServicesOff,
}

/// Everything one attendee's session holds: the venue, the live frame, and where they are.
///
/// A single [ChangeNotifier] rather than a state library. The web app manages the same problem
/// with plain hooks; one object with one screen listening to it does not need a store.
class WalkerSession extends ChangeNotifier with WidgetsBindingObserver {
  WalkerSession({
    required this.api,
    required this.walkerId,
    Future<LocationPermission> Function()? checkPermission,
    Future<LocationPermission> Function()? requestPermission,
    Future<bool> Function()? isLocationServiceEnabled,
    Stream<Position> Function()? positionStream,
  })  : _checkPermission = checkPermission ?? Geolocator.checkPermission,
        _requestPermission = requestPermission ?? Geolocator.requestPermission,
        _isServiceEnabled = isLocationServiceEnabled ?? Geolocator.isLocationServiceEnabled,
        _positionStream = positionStream ?? _defaultPositionStream;

  final ConcourseApi api;
  final String walkerId;

  // Injected so the permission and GPS paths are testable without a device or a mock framework.
  final Future<LocationPermission> Function() _checkPermission;
  final Future<LocationPermission> Function() _requestPermission;
  final Future<bool> Function() _isServiceEnabled;
  final Stream<Position> Function() _positionStream;

  static Stream<Position> _defaultPositionStream() => Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          // Metres. Under the smallest zone radius worth resolving, over ordinary GPS jitter.
          // Note this cuts *callbacks*, not GNSS duty cycle — the receiver stays powered either
          // way. It saves CPU wakeups and radio sends, which is worth having but is not the
          // reason the battery lasts. Foreground-only is.
          distanceFilter: 8,
        ),
      );

  String? sessionId;
  MapVenue? venue;
  Map<String, dynamic>? frame;
  String? error;
  bool connected = false;
  bool busy = false;

  PositionMode mode = PositionMode.manual;
  ManualReason manualReason = ManualReason.none;
  bool venueHasGeoref = false;

  /// The last thing the server said about our position. Null until it has said anything.
  Placement? placement;

  /// The route to the nearest exit, as map-space points, and its stated cost.
  List<Point>? routePath;
  String? routeDestination;
  double? routeCost;

  /// Set in [dispose]. Every async continuation checks it before touching state: a poll or a
  /// position report already in flight will land after the attendee has left the screen, and
  /// notifying a disposed ChangeNotifier throws.
  bool _disposed = false;

  Timer? _poll;
  StreamSubscription<Position>? _positions;
  DateTime? _lastSentAt;
  Fix? _lastSentFix;

  /// The zone we are currently counted in, whichever mode put us there.
  String? get nodeId => placement?.nodeId;

  MapHall? get here => nodeId == null ? null : venue?.hallById(nodeId!);

  List<MapHall> get exits {
    final halls = venue?.halls ?? const <MapHall>[];
    return halls.where((hall) => hall.isExit).toList();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  // ------------------------------------------------------------------ joining

  Future<void> join(String id) async {
    busy = true;
    error = null;
    _notify();
    try {
      final info = await api.getSession(id);
      final venueId = info['venueId'] as String;
      venue = MapVenue.fromJson(await api.getVenue(venueId));
      sessionId = id;
      venueHasGeoref = await api.hasGeoref(venueId);
      if (!venueHasGeoref) {
        mode = PositionMode.manual;
        manualReason = ManualReason.venueNotGeoreferenced;
      }
      await _startPolling();
      WidgetsBinding.instance.addObserver(this);
    } on ApiError catch (e) {
      error = e.status == 404 ? 'No session found with ID "$id".' : e.message;
      rethrow;
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> leave() async {
    _poll?.cancel();
    await _positions?.cancel();
    _positions = null;
    if (sessionId != null) await api.leave(sessionId!, walkerId);
    WidgetsBinding.instance.removeObserver(this);
    sessionId = null;
    venue = null;
    frame = null;
    placement = null;
    routePath = null;
    _notify();
  }

  // ------------------------------------------------------------------ the live frame

  /// Polls rather than holding the socket.
  ///
  /// A broadcast frame carries up to 600 agent positions at ~5 Hz — around 240 KB/s — and this
  /// app is not allowed to draw a single one of them. Two seconds of zone densities is what it
  /// actually needs.
  Future<void> _startPolling() async {
    _poll?.cancel();
    // Awaited, so anyone who has awaited join() has a venue *and* its densities. Without this
    // the first paint shows every zone at zero for up to two seconds.
    await _refresh();
    if (_disposed) return;
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _refresh());
  }

  Future<void> _refresh() async {
    if (sessionId == null) return;
    try {
      final next = await api.getState(sessionId!);
      frame = next;
      connected = true;
      error = null;
      final nodes = next['nodes'];
      if (nodes is List) venue?.applyDensities(nodes);
    } on ApiError catch (e) {
      // Keep the last frame on screen and say the connection is stale, rather than blanking a
      // map an attendee may be using to leave a building.
      connected = false;
      error = e.message;
    }
    _notify();
  }

  // ------------------------------------------------------------------ position

  /// Asks for location and starts streaming, or explains why it cannot.
  ///
  /// Never throws and never leaves the app unusable: every failure path lands in manual mode
  /// with a reason the UI can state plainly.
  Future<void> enableGps() async {
    if (!venueHasGeoref) {
      _fallBack(ManualReason.venueNotGeoreferenced);
      return;
    }
    if (!await _isServiceEnabled()) {
      _fallBack(ManualReason.locationServicesOff);
      return;
    }

    var permission = await _checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await _requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      _fallBack(ManualReason.permissionDeniedForever);
      return;
    }
    if (permission == LocationPermission.denied) {
      _fallBack(ManualReason.permissionDenied);
      return;
    }

    mode = PositionMode.gps;
    manualReason = ManualReason.none;
    _notify();

    _positions?.cancel();
    _positions = _positionStream().listen(_onFix, onError: (_) {
      // A stream error is not fatal — the attendee can still tap a zone.
      _fallBack(ManualReason.locationServicesOff);
    });
  }

  void _fallBack(ManualReason reason) {
    mode = PositionMode.manual;
    manualReason = reason;
    _positions?.cancel();
    _positions = null;
    _notify();
  }

  Future<void> _onFix(Position position) async {
    final fix = Fix(position.latitude, position.longitude, position.accuracy);
    final now = DateTime.now();
    if (!shouldSend(fix: fix, now: now, lastSentAt: _lastSentAt, lastSentFix: _lastSentFix)) {
      return;
    }
    _lastSentAt = now;
    _lastSentFix = fix;

    await _report({
      'lat': fix.lat,
      'lng': fix.lng,
      'accuracyMetres': fix.accuracyMetres,
    });
  }

  /// Self-declared position: the attendee tapped a zone.
  Future<void> selectZone(String nodeId) => _report({'nodeId': nodeId});

  Future<void> _report(Map<String, dynamic> body) async {
    if (sessionId == null) return;
    try {
      final next = await api.sendFix(sessionId!, walkerId, body);
      final movedZone = next.nodeId != placement?.nodeId;
      placement = next;
      error = null;
      if (movedZone && next.nodeId != null) {
        await _refreshRoute(next.nodeId!);
      } else if (next.nodeId == null) {
        routePath = null;
        routeDestination = null;
        routeCost = null;
      }
    } on ApiError catch (e) {
      if (e.status == 409) {
        // The venue lost its georeference under us. Manual still works.
        venueHasGeoref = false;
        _fallBack(ManualReason.venueNotGeoreferenced);
        return;
      }
      error = e.message;
    }
    _notify();
  }

  /// The way out, from the server's Dijkstra over the venue's own edges.
  ///
  /// Re-asked only when the zone changes: the layout cannot move mid-session. Note the same
  /// limitation the web Walker has — this route is not re-evaluated against live density, so it
  /// is the shortest way out rather than the clearest one.
  Future<void> _refreshRoute(String fromNodeId) async {
    if (venue == null) return;
    try {
      final route = await api.getRoute(venue!.id, fromNodeId);
      final path = (route['path'] as List<dynamic>?) ?? const [];
      final points = path
          .map((id) => venue!.hallById(id as String)?.centre)
          .whereType<Point>()
          .toList();
      routePath = points.length >= 2 ? points : null;
      routeDestination = route['toNodeId'] as String?;
      routeCost = (route['cost'] as num?)?.toDouble();
    } on ApiError {
      // Losing the route must not cost the map. Drop it and leave everything else standing.
      routePath = null;
      routeDestination = null;
      routeCost = null;
    }
  }

  // ------------------------------------------------------------------ lifecycle

  /// Foreground only.
  ///
  /// No background permission is requested and none would work. Beyond the store-review cost,
  /// it is the right semantics: a phone in a pocket says nothing useful about where its owner
  /// is going, and an attendee who closes the app ages out of the venue in 30 seconds.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (sessionId != null) _startPolling();
      if (mode == PositionMode.gps && _positions == null) enableGps();
    } else if (state == AppLifecycleState.paused) {
      _poll?.cancel();
      _positions?.cancel();
      _positions = null;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    _positions?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    api.close();
    super.dispose();
  }
}
