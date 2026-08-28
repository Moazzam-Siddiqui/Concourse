import 'package:concourse_walker/location_gate.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final t0 = DateTime(2026, 8, 12, 12, 0, 0);
  const here = Fix(12.9716, 77.5946, 8);

  /// ~12 m north of [here] — over the 8 m movement threshold.
  const movedFar = Fix(12.97171, 77.5946, 8);

  /// ~1 m north — under it.
  const movedLittle = Fix(12.971609, 77.5946, 8);

  group('shouldSend', () {
    test('sends the first fix immediately', () {
      expect(shouldSend(fix: here, now: t0, lastSentAt: null, lastSentFix: null), isTrue);
    });

    test('drops a fix too inaccurate to be worth the radio', () {
      expect(
        shouldSend(fix: const Fix(12.9716, 77.5946, 80), now: t0, lastSentAt: null),
        isFalse,
      );
    });

    /// Bad fixes are rejected before rate limiting, so a burst of useless ones cannot consume
    /// the interval budget and stall a good fix behind them.
    test('rejects an inaccurate fix without spending the interval budget', () {
      final justSent = t0.subtract(const Duration(seconds: 1));
      expect(
        shouldSend(fix: const Fix(12.9716, 77.5946, 90), now: t0, lastSentAt: justSent),
        isFalse,
      );
      // The good fix that follows is still gated only by the interval, not by the bad one.
      expect(
        shouldSend(
            fix: movedFar,
            now: t0.add(const Duration(seconds: 3)),
            lastSentAt: justSent,
            lastSentFix: here),
        isTrue,
      );
    });

    test('holds off inside the minimum interval however far you moved', () {
      expect(
        shouldSend(
            fix: movedFar,
            now: t0.add(const Duration(seconds: 2)),
            lastSentAt: t0,
            lastSentFix: here),
        isFalse,
      );
    });

    test('sends once you have moved far enough, after the interval', () {
      expect(
        shouldSend(
            fix: movedFar,
            now: t0.add(const Duration(seconds: 4)),
            lastSentAt: t0,
            lastSentFix: here),
        isTrue,
      );
    });

    test('stays quiet when you have barely moved', () {
      expect(
        shouldSend(
            fix: movedLittle,
            now: t0.add(const Duration(seconds: 5)),
            lastSentAt: t0,
            lastSentFix: here),
        isFalse,
      );
    });

    /// The case whose absence makes a stationary attendee vanish.
    ///
    /// With a distance filter alone, standing still means sending nothing, and
    /// `session.walker-ttl-ms` (30 s) then ages them out of the venue while they are physically
    /// standing in it. The heartbeat must fire well before that.
    test('sends a heartbeat when standing perfectly still', () {
      expect(
        shouldSend(
            fix: movedLittle,
            now: t0.add(const Duration(seconds: 25)),
            lastSentAt: t0,
            lastSentFix: here),
        isTrue,
      );
    });

    test('heartbeats comfortably before the server TTL expires', () {
      expect(kMaxInterval.inSeconds, lessThan(30));
      expect(kMaxInterval, greaterThan(kMinInterval));
    });
  });

  group('metresBetween', () {
    test('measures a short northward step', () {
      // 0.00011 degrees of latitude is ~12.2 m.
      expect(metresBetween(here, movedFar), closeTo(12.2, 0.5));
    });

    test('is symmetric and zero for the same point', () {
      expect(metresBetween(here, here), closeTo(0, 0.001));
      expect(metresBetween(here, movedFar), closeTo(metresBetween(movedFar, here), 0.001));
    });
  });
}
