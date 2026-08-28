import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'screens/consent.dart';
import 'screens/join.dart';
import 'screens/live.dart';
import 'walker_session.dart';

/// Where the backend is. Override for a device on the same network:
///
///   flutter run --dart-define=CONCOURSE_API=http://192.168.1.20:8080
///
/// A phone cannot reach the host's localhost, so this needs setting for any real test. It is a
/// dart-define rather than a settings screen because it is a developer concern — an attendee at
/// a venue never types a URL.
const String kApiBase =
    String.fromEnvironment('CONCOURSE_API', defaultValue: 'http://10.0.2.2:8080');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();

  // One opaque id, generated once and kept. Regenerating it per launch would leave the previous
  // one ageing out in the venue, counting a person who is not there.
  var walkerId = prefs.getString('walkerId');
  if (walkerId == null) {
    walkerId = 'w-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    await prefs.setString('walkerId', walkerId);
  }

  runApp(WalkerApp(
    prefs: prefs,
    session: WalkerSession(
      api: ConcourseApi(baseUrl: kApiBase),
      walkerId: walkerId,
    ),
  ));
}

class WalkerApp extends StatefulWidget {
  const WalkerApp({super.key, required this.prefs, required this.session});

  final SharedPreferences prefs;
  final WalkerSession session;

  @override
  State<WalkerApp> createState() => _WalkerAppState();
}

enum _Screen { consent, join, live }

class _WalkerAppState extends State<WalkerApp> {
  late _Screen _screen =
      widget.prefs.getBool('consented') == true ? _Screen.join : _Screen.consent;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Concourse',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF05070B),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4D8DF0),
          brightness: Brightness.dark,
        ),
      ),
      home: switch (_screen) {
        _Screen.consent => ConsentScreen(onAccept: () async {
            await widget.prefs.setBool('consented', true);
            setState(() => _screen = _Screen.join);
          }),
        _Screen.join => JoinScreen(
            session: widget.session,
            onJoined: () {
              setState(() => _screen = _Screen.live);
              // Offer GPS only after the venue is known — asking before we can say whether the
              // venue even supports it would be a permission prompt we might not be able to use.
              widget.session.enableGps();
            },
          ),
        _Screen.live => LiveScreen(
            session: widget.session,
            onLeave: () async {
              await widget.session.leave();
              setState(() => _screen = _Screen.join);
            },
          ),
      },
    );
  }
}
