import 'package:flutter/material.dart';

import '../venue_map.dart';

/// Shown once, before anything else, and before any system permission dialog.
///
/// Every clause below is literally true of the implementation, which is the only reason it is
/// worth showing. A GPS fix is resolved to a zone at the ingest boundary and the coordinates are
/// discarded — `Session` has a zone id and an expiry per attendee and nowhere to put a
/// coordinate. If that ever stops being true, this screen has to change in the same commit.
class ConsentScreen extends StatelessWidget {
  const ConsentScreen({super.key, required this.onAccept});

  final VoidCallback onAccept;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF05070B),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 24),
              const Text('CONCOURSE',
                  style: TextStyle(
                      color: kBlueHi, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 2.4)),
              const SizedBox(height: 8),
              const Text('Before you start',
                  style: TextStyle(color: kInk, fontSize: 30, fontWeight: FontWeight.w800)),
              const SizedBox(height: 20),
              const Text(
                'This app shows how busy each part of the venue is, and the clearest way out.',
                style: TextStyle(color: kDim, fontSize: 15, height: 1.5),
              ),
              const SizedBox(height: 28),
              const _Point(
                title: 'A zone, not a position',
                body: 'If you turn on location, your phone works out where you are and the venue '
                    'is told which zone that is — Gate A, the north walkway. Your coordinates are '
                    'used to answer that question and then thrown away. They are never stored.',
              ),
              const _Point(
                title: 'Only while the app is open',
                body: 'Location stops the moment you leave the app, and you drop off the venue map '
                    'about thirty seconds later. There is no background tracking.',
              ),
              const _Point(
                title: 'Nobody can see you',
                body: 'Staff see how many people are in each zone. They cannot see you, and no '
                    'other attendee can either.',
              ),
              const _Point(
                title: 'No account, and you can skip it',
                body: 'There is no sign-in and nothing linking this to you. Location is optional — '
                    'without it you just tap the zone you are standing in, and everything else works '
                    'the same.',
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: onAccept,
                  style: FilledButton.styleFrom(
                    backgroundColor: kBlueHi,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Text('Continue',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}

class _Point extends StatelessWidget {
  const _Point({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style: const TextStyle(color: kInk, fontSize: 14, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(body, style: const TextStyle(color: kDim, fontSize: 13, height: 1.45)),
        ]),
      );
}
