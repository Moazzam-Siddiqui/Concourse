import 'package:flutter/material.dart';

import 'api.dart';
import 'map_projection.dart';

/// The congestion ramp, matching `densityColor` in `frontend/ConcourseApp.jsx` exactly.
///
/// Same four thresholds, same four colours. An attendee who checks the web map and then the app
/// must not see a zone described two different ways.
Color densityColour(double density) {
  if (density > 0.85) return const Color(0xFFE10600);
  if (density > 0.70) return const Color(0xFFFF6A00);
  if (density > 0.50) return const Color(0xFFFFB020);
  return const Color(0xFF00C853);
}

const _ink = Color(0xFFEEF2F8);
const _dim = Color(0xFF8A97AC);
const _blueHi = Color(0xFF4D8DF0);
const _line = Color(0xFF2A3852);

/// Draws the venue: corridors, zones tinted by density, the route out, and you.
///
/// A [CustomPainter] rather than a map library. There is no basemap to put under this — the
/// venue is an abstract 0–100 coordinate space — and satellite tiles beneath a stylised layout
/// would misalign wherever the anchor fit is imperfect, advertising a precision the system does
/// not have. Everything here is polygons, polylines and dots.
class VenueMapView extends StatelessWidget {
  const VenueMapView({
    super.key,
    required this.venue,
    required this.placement,
    this.routePath,
    this.onSelectZone,
    this.selectedZoneId,
  });

  final MapVenue venue;
  final Placement? placement;
  final List<Point>? routePath;
  final void Function(String nodeId)? onSelectZone;
  final String? selectedZoneId;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, constraints) {
      final size = Size(constraints.maxWidth, constraints.maxHeight);
      return GestureDetector(
        onTapUp: onSelectZone == null ? null : (details) => _handleTap(details.localPosition, size),
        child: InteractiveViewer(
          minScale: 0.8,
          maxScale: 4,
          child: CustomPaint(
            size: size,
            painter: _VenuePainter(
              venue: venue,
              placement: placement,
              routePath: routePath,
              selectedZoneId: selectedZoneId,
            ),
          ),
        ),
      );
    });
  }

  /// Nearest zone to the tap, within its own radius. Same rule the server uses for a GPS fix,
  /// so tapping between zones does nothing rather than snapping somewhere arbitrary.
  void _handleTap(Offset local, Size size) {
    final scale = _scaleFor(size);
    final offset = _offsetFor(size, scale);
    final x = (local.dx - offset.dx) / scale;
    final y = (local.dy - offset.dy) / scale;

    for (final hall in venue.halls) {
      final dx = x - hall.centre.x;
      final dy = y - hall.centre.y;
      if (dx * dx + dy * dy <= hall.radius * hall.radius) {
        onSelectZone!(hall.id);
        return;
      }
    }
  }
}

/// The 0–100 box fitted into the widget, preserving aspect.
double _scaleFor(Size size) => (size.shortestSide) / 100.0;

Offset _offsetFor(Size size, double scale) =>
    Offset((size.width - 100 * scale) / 2, (size.height - 100 * scale) / 2);

class _VenuePainter extends CustomPainter {
  _VenuePainter({
    required this.venue,
    required this.placement,
    required this.routePath,
    required this.selectedZoneId,
  });

  final MapVenue venue;
  final Placement? placement;
  final List<Point>? routePath;
  final String? selectedZoneId;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = _scaleFor(size);
    final origin = _offsetFor(size, scale);
    Offset at(Point p) => Offset(origin.dx + p.x * scale, origin.dy + p.y * scale);

    canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFF070B12));

    // Corridors: casing then fill, the way map roads are drawn.
    final casing = Paint()
      ..color = const Color(0xFF16233A)
      ..strokeWidth = 3.6 * scale
      ..strokeCap = StrokeCap.round;
    final fill = Paint()
      ..color = const Color(0xFF22334F)
      ..strokeWidth = 2.2 * scale
      ..strokeCap = StrokeCap.round;
    for (final corridor in venue.corridors) {
      canvas.drawLine(at(corridor[0]), at(corridor[1]), casing);
      canvas.drawLine(at(corridor[0]), at(corridor[1]), fill);
    }

    for (final hall in venue.halls) {
      final colour = densityColour(hall.density);
      final path = Path()..addPolygon(hall.points.map(at).toList(), true);

      // A soft wash whose strength tracks density, so a busy zone reads as busy at a glance
      // without the number having to be read.
      canvas.drawPath(path, Paint()..color = colour.withValues(alpha: 0.12 + hall.density.clamp(0, 1) * 0.45));
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = (hall.id == selectedZoneId ? 1.4 : 0.6) * scale
          ..color = hall.id == selectedZoneId ? _blueHi : _line,
      );

      _label(canvas, hall.name.toUpperCase(), at(hall.centre) + Offset(0, hall.radius * scale + 6 * scale),
          size: 8 * scale, colour: _ink);
      _label(canvas, '${(hall.density * 100).round()}%',
          at(hall.centre) + Offset(0, hall.radius * scale + 16 * scale),
          size: 8 * scale, colour: colour);
    }

    // The way out.
    final route = routePath;
    if (route != null && route.length > 1) {
      final line = Path()..moveTo(at(route.first).dx, at(route.first).dy);
      for (final point in route.skip(1)) {
        line.lineTo(at(point).dx, at(point).dy);
      }
      canvas.drawPath(
          line,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2.6 * scale
            ..strokeCap = StrokeCap.round
            ..color = const Color(0xFF0A2A5E));
      canvas.drawPath(
          line,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.4 * scale
            ..strokeCap = StrokeCap.round
            ..color = _blueHi);
      canvas.drawCircle(at(route.last), 1.8 * scale, Paint()..color = const Color(0xFF00C853));
    }

    // You — and only when the server was willing to say where that is.
    //
    // Every other placement state means the position is not known. Drawing a dot anyway is the
    // one thing this map must never do, so there is deliberately no else branch here.
    final fixed = placement;
    if (fixed != null && fixed.hasPosition) {
      final centre = at(Point(fixed.x!, fixed.y!));
      final accuracy = (fixed.accuracyVenueUnits ?? 0) * scale;
      if (accuracy > 0) {
        // Never smaller than reported. A flattering halo is a lie about the sensor.
        canvas.drawCircle(centre, accuracy, Paint()..color = _blueHi.withValues(alpha: 0.16));
      }
      canvas.drawCircle(centre, 2.2 * scale, Paint()..color = Colors.white);
      canvas.drawCircle(centre, 1.6 * scale, Paint()..color = _blueHi);
    }
  }

  void _label(Canvas canvas, String text, Offset centre,
      {required double size, required Color colour}) {
    if (size < 5) return; // Below this it is noise, not a label.
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: colour,
          fontSize: size,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.6,
          shadows: const [Shadow(color: Color(0xFF070B12), blurRadius: 3)],
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
    )..layout();
    painter.paint(canvas, centre - Offset(painter.width / 2, 0));
  }

  @override
  bool shouldRepaint(covariant _VenuePainter old) => true;
}

/// A small live/offline pill. Every screen shows one, so the connection state is never a
/// mystery — ported from the web app's `ConnectionPill` for exactly that reason.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.colour});

  final String label;
  final Color colour;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: colour.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: colour.withValues(alpha: 0.4)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 6, height: 6, decoration: BoxDecoration(color: colour, shape: BoxShape.circle)),
          const SizedBox(width: 6),
          Text(label,
              style: TextStyle(color: colour, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
        ]),
      );
}

/// Surfaces a failure without pretending the data is fine. Renders nothing when there is none.
class ErrorNote extends StatelessWidget {
  const ErrorNote({super.key, required this.error});

  final String? error;

  @override
  Widget build(BuildContext context) {
    if (error == null) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFE10600).withValues(alpha: 0.08),
        border: Border.all(color: const Color(0xFFE10600).withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(error!, style: const TextStyle(color: Color(0xFFE10600), fontSize: 12)),
    );
  }
}

const kDim = _dim;
const kInk = _ink;
const kBlueHi = _blueHi;
