import 'package:concourse_walker/api.dart';
import 'package:concourse_walker/map_projection.dart';
import 'package:concourse_walker/venue_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The map must never draw a position the server declined to give it.
///
/// Every rejected state means "we do not know where you are". Painting a dot anyway — at the
/// last known point, at a zone centre, anywhere — invents precision, which is the single thing
/// this UI exists not to do.
void main() {
  final venue = MapVenue.fromJson({
    'id': 'venue-1',
    'name': 'Test',
    'nodes': [
      {'id': 'gate', 'name': 'Gate', 'type': 'GATE', 'capacity': 320, 'x': 0, 'y': 0},
      {'id': 'exit', 'name': 'Exit', 'type': 'EXIT', 'capacity': 400, 'x': 400, 'y': 0},
    ],
    'edges': [
      {'from': 'gate', 'to': 'exit', 'length': 40, 'width': 6, 'bidirectional': true},
    ],
  });

  group('Placement.hasPosition', () {
    test('is true only when the server placed us somewhere', () {
      const inZone = Placement(state: 'IN_ZONE', nodeId: 'gate', x: 10, y: 20, accuracyVenueUnits: 5);
      const manual = Placement(state: 'MANUAL', nodeId: 'gate', x: 10, y: 20);
      expect(inZone.hasPosition, isTrue);
      expect(manual.hasPosition, isTrue);
    });

    test('is false for every rejection, even when coordinates came back', () {
      // The server echoes x/y for IN_TRANSIT and OUTSIDE_VENUE so a client *could* draw them.
      // It must not: knowing roughly where a fix landed is not the same as knowing where the
      // person is, and the states exist precisely to say so.
      const inTransit = Placement(state: 'IN_TRANSIT', x: 50, y: 50, accuracyVenueUnits: 4);
      const outside = Placement(state: 'OUTSIDE_VENUE', x: 900, y: 900, accuracyVenueUnits: 4);
      const inaccurate = Placement(state: 'TOO_INACCURATE', x: 10, y: 20, accuracyVenueUnits: 300);

      expect(inTransit.hasPosition, isFalse);
      expect(outside.hasPosition, isFalse);
      expect(inaccurate.hasPosition, isFalse);
      expect(inTransit.counts, isFalse);
      expect(inaccurate.counts, isFalse);
    });
  });

  testWidgets('renders the map for a rejected fix without crashing or placing a dot',
      (tester) async {
    for (final state in ['IN_TRANSIT', 'OUTSIDE_VENUE', 'TOO_INACCURATE']) {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 400,
            height: 400,
            child: VenueMapView(
              venue: venue,
              placement: Placement(state: state, x: 50, y: 50, accuracyVenueUnits: 6),
            ),
          ),
        ),
      ));
      expect(tester.takeException(), isNull, reason: 'state $state');
    }
  });

  testWidgets('renders with no placement at all', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 400,
          height: 400,
          child: VenueMapView(venue: venue, placement: null),
        ),
      ),
    ));
    expect(tester.takeException(), isNull);
  });

  group('densityColour', () {
    /// Must agree with `densityColor` in frontend/ConcourseApp.jsx. An attendee who checks the
    /// web map and then the app must not see one zone described two different ways.
    test('uses the same four thresholds as the web app', () {
      expect(densityColour(0.00), const Color(0xFF00C853));
      expect(densityColour(0.50), const Color(0xFF00C853));
      expect(densityColour(0.51), const Color(0xFFFFB020));
      expect(densityColour(0.70), const Color(0xFFFFB020));
      expect(densityColour(0.71), const Color(0xFFFF6A00));
      expect(densityColour(0.85), const Color(0xFFFF6A00));
      expect(densityColour(0.86), const Color(0xFFE10600));
      // Over capacity is the interesting case, and must not wrap or clamp to a calmer colour.
      expect(densityColour(2.5), const Color(0xFFE10600));
    });
  });
}
