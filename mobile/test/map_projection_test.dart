import 'package:concourse_walker/map_projection.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('nodeRadius', () {
    /// The drift guard.
    ///
    /// This curve now exists in three places: here, `frontend/src/venueAdapter.js`, and
    /// `SimulationEngine.nodeRadius`, which is the one that decides where agents actually are.
    /// The other two only draw. If they disagree, the crowd renders outside the rooms and the
    /// GPS radius-reject accepts fixes the simulation would not — and nothing else in the
    /// system would notice. These are the published values from the Java implementation.
    test('matches the values the backend computes', () {
      expect(nodeRadius(320), closeTo(18.733, 0.001));
      expect(nodeRadius(500), closeTo(21.416, 0.001));
      expect(nodeRadius(900), closeTo(26.000, 0.001));
      expect(nodeRadius(90), closeTo(13.692, 0.001));
    });

    test('clamps at both ends rather than growing without limit', () {
      expect(nodeRadius(0), 10.0);
      expect(nodeRadius(1), 10.0);
      expect(nodeRadius(1000000), 44.0);
    });
  });

  group('Projection', () {
    List<VenueNode> nodes() => const [
          VenueNode(id: 'a', name: 'A', type: 'GATE', capacity: 320, x: 0, y: 0),
          VenueNode(id: 'b', name: 'B', type: 'EXIT', capacity: 320, x: 400, y: 200),
        ];

    test('keeps the venue inside the 0-100 box', () {
      final projection = Projection.of(nodes());
      for (final node in nodes()) {
        final point = projection.toMap(node.x, node.y);
        expect(point.x, inInclusiveRange(0, 100));
        expect(point.y, inInclusiveRange(0, 100));
      }
    });

    /// A venue authored at twice the size keeps its *shape*, so the same layout does not draw
    /// differently depending on what units its author happened to pick.
    ///
    /// Note what is deliberately **not** asserted: that it draws at the same absolute size.
    /// The bounding box is padded by [nodeRadius], which comes from capacity and is therefore
    /// absolute — a 320-capacity gate is 18.7 units across whether the venue is 400 units wide
    /// or 800. So the padding is a smaller fraction of a larger venue and the fitted scale is
    /// not a pure ratio. That is correct: zone size is a property of the zone, not of the
    /// drawing. An earlier version of this test asserted the pure-ratio version and failed.
    test('preserves a venue\'s proportions at twice the scale', () {
      double aspect(Projection p, double x, double y) {
        final origin = p.toMap(0, 0);
        final far = p.toMap(x, y);
        return (far.x - origin.x) / (far.y - origin.y);
      }

      final small = Projection.of(nodes());
      final large = Projection.of(const [
        VenueNode(id: 'a', name: 'A', type: 'GATE', capacity: 320, x: 0, y: 0),
        VenueNode(id: 'b', name: 'B', type: 'EXIT', capacity: 320, x: 800, y: 400),
      ]);

      expect(aspect(large, 800, 400), closeTo(aspect(small, 400, 200), 0.001));
      // And both are the 2:1 the coordinates describe.
      expect(aspect(small, 400, 200), closeTo(2.0, 0.001));
    });

    test('uses one uniform scale, so a long thin venue is not stretched square', () {
      final projection = Projection.of(const [
        VenueNode(id: 'a', name: 'A', type: 'GATE', capacity: 100, x: 0, y: 0),
        VenueNode(id: 'b', name: 'B', type: 'EXIT', capacity: 100, x: 1000, y: 100),
      ]);
      final a = projection.toMap(0, 0);
      final b = projection.toMap(1000, 100);

      // 10:1 in layout units must stay 10:1 on the map.
      expect((b.x - a.x) / (b.y - a.y), closeTo(10.0, 0.01));
    });
  });

  group('MapVenue', () {
    final json = {
      'id': 'venue-1',
      'name': 'Test',
      'nodes': [
        {'id': 'gate', 'name': 'Gate', 'type': 'GATE', 'capacity': 320, 'x': 0, 'y': 0},
        {'id': 'exit', 'name': 'Exit', 'type': 'EXIT', 'capacity': 400, 'x': 400, 'y': 0},
      ],
      'edges': [
        {'from': 'gate', 'to': 'exit', 'length': 40, 'width': 6, 'bidirectional': true},
      ],
    };

    test('builds halls and corridors from the graph', () {
      final venue = MapVenue.fromJson(json);

      expect(venue.halls, hasLength(2));
      expect(venue.corridors, hasLength(1));
      expect(venue.halls.first.points, hasLength(8));
      expect(venue.exitsCount, 1);
    });

    test('folds a frame\'s densities onto the halls it names', () {
      final venue = MapVenue.fromJson(json);
      venue.applyDensities([
        {'nodeId': 'gate', 'density': 0.93, 'status': 'CRITICAL'},
        {'nodeId': 'unknown-zone', 'density': 0.5, 'status': 'OK'},
      ]);

      expect(venue.hallById('gate')!.density, 0.93);
      expect(venue.hallById('gate')!.status, 'CRITICAL');
      // A node the venue does not have is ignored, not invented.
      expect(venue.hallById('unknown-zone'), isNull);
      expect(venue.hallById('exit')!.density, 0);
    });
  });
}

extension on MapVenue {
  int get exitsCount => halls.where((h) => h.isExit).length;
}
