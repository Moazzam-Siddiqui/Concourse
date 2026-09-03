/**
 * Subscribes to `WS /sessions/{id}/stream` and keeps the latest frame.
 *
 * The backend pushes a full `SessionState` every other tick (~5 Hz), so there is nothing to
 * merge — each frame replaces the last. Everything the map draws comes from here.
 */

import { useEffect, useRef, useState } from 'react';

// Derived from whatever api.js resolved, rather than re-deriving it here.
//
// This used to fall back to VITE_API_BASE_URL and then to localhost independently, so a
// production build with that variable unset opened a socket to ws://localhost:8080 - the
// visitor's own machine. The session was created on the server and ticking, but the page
// never received a frame: it showed OFFLINE and TICK 0 forever, which reads as a broken
// simulation rather than as a failed connection.
//
// Reading api.baseUrl means the socket and the REST calls can never disagree about which
// backend they are talking to. The replace turns https into wss, and http into ws.
import { api } from './api.js';

const WS_BASE =
  import.meta.env.VITE_WS_BASE_URL ?? api.baseUrl.replace(/^http/, 'ws');

/** Reconnect backoff in ms. Caps out rather than growing forever. */
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

/**
 * @param sessionId session to watch, or null/undefined to stay disconnected
 * @returns {{state, connected, error}} `state` is the last frame received, null until the first
 */
export function useLiveSession(sessionId) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  // Held in refs so a reconnect does not re-run the effect and tear down the socket it just made.
  const socketRef = useRef(null);
  const retryRef = useRef(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setState(null);
      setConnected(false);
      return undefined;
    }

    // A new session is a new subject — drop the previous session's last frame rather than
    // showing it under the new session's name until the first frame lands.
    setState(null);
    setError(null);

    let disposed = false;

    const connect = () => {
      if (disposed) return;

      const socket = new WebSocket(`${WS_BASE}/sessions/${sessionId}/stream`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        attemptRef.current = 0;
        setConnected(true);
        setError(null);
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          setState(JSON.parse(event.data));
        } catch {
          setError('Malformed frame from server');
        }
      };

      socket.onerror = () => {
        // onerror is always followed by onclose, which is where the retry lives. Setting a
        // message here as well would flash an error every reconnect.
        if (!disposed) setConnected(false);
      };

      socket.onclose = (event) => {
        if (disposed) return;
        setConnected(false);
        // 1000 is a clean close — the session ended or we navigated away. Anything else is the
        // backend restarting or the network blipping, and is worth retrying.
        if (event.code === 1000) return;

        const delay = RETRY_MS[Math.min(attemptRef.current, RETRY_MS.length - 1)];
        attemptRef.current += 1;
        setError(`Connection lost — retrying in ${delay / 1000}s`);
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryRef.current);
      // 1000 so the server-side handler deregisters us cleanly instead of waiting for a timeout.
      socketRef.current?.close(1000, 'component unmounted');
      socketRef.current = null;
    };
  }, [sessionId]);

  return { state, connected, error };
}

export default useLiveSession;
