import 'dart:convert';

import 'package:concourse_walker/api.dart';
import 'package:concourse_walker/walker_session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;

/// The venue every test here joins.
final _venue = {
  'id': 'venue-1',
  'name': 'Test Arena',
  'nodes': [
    {'id': 'gate', 'name': 'Gate', 'type': 'GATE', 'capacity': 320, 'x': 0, 'y': 0},
    {'id': 'exit', 'name': 'Exit', 'type': 'EXIT', 'capacity': 400, 'x': 400, 'y': 0},
  ],
  'edges': [
    {'from': 'gate', 'to': 'exit', 'length': 40, 'width': 6, 'bidirectional': true},
  ],
};

/// A backend that records what it was asked, so a test can assert on what was *not* sent.
class _Recorder {
  final List<String> paths = [];
  final List<Map<String, dynamic>> bodies = [];
  bool georeferenced;

  _Recorder({this.georeferenced = false});

  http.Client client() => MockClient((request) async {
        paths.add('${request.method} ${request.url.path}');
        if (request.body.isNotEmpty) {
          bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
        }
        final path = request.url.path;

        if (path == '/sessions/sess-1') {
          return http.Response(jsonEncode({'sessionId': 'sess-1', 'venueId': 'venue-1'}), 200);
        }
        if (path == '/venues/venue-1') {
          return http.Response(jsonEncode(_venue), 200);
        }
        if (path == '/venues/venue-1/georef') {
          return georeferenced
              ? http.Response(jsonEncode({'venueId': 'venue-1'}), 200)
              : http.Response(jsonEncode({'message': 'not georeferenced'}), 404);
        }
        if (path == '/sessions/sess-1/state') {
          return http.Response(
              jsonEncode({
                'nodes': [
                  {'nodeId': 'gate', 'density': 0.2, 'status': 'OK'},
                  {'nodeId': 'exit', 'density': 0.1, 'status': 'OK'},
                ],
                'metrics': {'peopleInside': 10},
              }),
              200);
        }
        if (path.startsWith('/sessions/sess-1/walkers/')) {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
              jsonEncode({
                'walkerId': 'w-1',
                'nodeId': body['nodeId'] ?? 'gate',
                'state': body['nodeId'] != null ? 'MANUAL' : 'IN_ZONE',
                'x': 0.0,
                'y': 0.0,
                'accuracyVenueUnits': 0.0,
                'expiresInSeconds': 30,
              }),
              200);
        }
        if (path == '/venues/venue-1/route') {
          return http.Response(
              jsonEncode({'fromNodeId': 'gate', 'toNodeId': 'exit', 'path': ['gate', 'exit'], 'cost': 40}),
              200);
        }
        return http.Response('{}', 404);
      });
}

WalkerSession _session(
  _Recorder recorder, {
  required LocationPermission permission,
  bool servicesEnabled = true,
}) =>
    WalkerSession(
      api: ConcourseApi(baseUrl: 'http://venue.test', client: recorder.client()),
      walkerId: 'w-1',
      checkPermission: () async => permission,
      requestPermission: () async => permission,
      isLocationServiceEnabled: () async => servicesEnabled,
      positionStream: () => const Stream<Position>.empty(),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('permission denied', () {
    test('falls back to manual and never sends a coordinate', () async {
      final recorder = _Recorder(georeferenced: true);
      final session = _session(recorder, permission: LocationPermission.denied);

      await session.join('sess-1');
      await session.enableGps();

      expect(session.mode, PositionMode.manual);
      expect(session.manualReason, ManualReason.permissionDenied);

      // The app is still fully usable: tapping a zone places the attendee.
      await session.selectZone('gate');
      expect(session.nodeId, 'gate');

      // The assertion that matters — nothing carrying a position ever left the device.
      for (final body in recorder.bodies) {
        expect(body.containsKey('lat'), isFalse, reason: 'sent $body');
        expect(body.containsKey('lng'), isFalse, reason: 'sent $body');
      }
      session.dispose();
    });

    test('distinguishes a permanent block, which needs Settings', () async {
      final recorder = _Recorder(georeferenced: true);
      final session = _session(recorder, permission: LocationPermission.deniedForever);

      await session.join('sess-1');
      await session.enableGps();

      expect(session.manualReason, ManualReason.permissionDeniedForever);
      session.dispose();
    });
  });

  test('location services off falls back without asking for permission', () async {
    final recorder = _Recorder(georeferenced: true);
    final session = _session(recorder,
        permission: LocationPermission.always, servicesEnabled: false);

    await session.join('sess-1');
    await session.enableGps();

    expect(session.mode, PositionMode.manual);
    expect(session.manualReason, ManualReason.locationServicesOff);
    session.dispose();
  });

  /// The common case: most venues will never be georeferenced.
  test('a venue without anchors never asks for location at all', () async {
    final recorder = _Recorder(georeferenced: false);
    var permissionAsked = false;
    final session = WalkerSession(
      api: ConcourseApi(baseUrl: 'http://venue.test', client: recorder.client()),
      walkerId: 'w-1',
      checkPermission: () async {
        permissionAsked = true;
        return LocationPermission.always;
      },
      requestPermission: () async => LocationPermission.always,
      isLocationServiceEnabled: () async => true,
      positionStream: () => const Stream<Position>.empty(),
    );

    await session.join('sess-1');
    await session.enableGps();

    expect(session.venueHasGeoref, isFalse);
    expect(session.mode, PositionMode.manual);
    expect(session.manualReason, ManualReason.venueNotGeoreferenced);
    expect(permissionAsked, isFalse,
        reason: 'asking for a permission the venue cannot use is a prompt for nothing');
    session.dispose();
  });

  test('a placed attendee gets a route to the nearest exit', () async {
    final recorder = _Recorder();
    final session = _session(recorder, permission: LocationPermission.denied);

    await session.join('sess-1');
    await session.selectZone('gate');

    expect(session.routeDestination, 'exit');
    expect(session.routeCost, 40);
    expect(session.routePath, hasLength(2));
    session.dispose();
  });

  test('polls state without agent positions', () async {
    final recorder = _Recorder();
    final session = _session(recorder, permission: LocationPermission.denied);

    await session.join('sess-1');

    // The query string carries people=false; the recorder only keeps paths, so assert on the
    // fact that state was fetched at all and that densities landed on the halls.
    expect(recorder.paths, contains('GET /sessions/sess-1/state'));
    expect(session.venue!.hallById('gate')!.density, 0.2);
    session.dispose();
  });
}
