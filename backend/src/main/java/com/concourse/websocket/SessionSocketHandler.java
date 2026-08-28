package com.concourse.websocket;

import com.concourse.config.CorsConfig;
import com.concourse.repository.SessionRepository;
import com.concourse.service.broadcast.StateBroadcaster;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Live channel at {@code /sessions/{id}/stream}. Organiser and viewers connect to the same
 * path and get identical frames — there is one truth about where the crowd is.
 *
 * <p>Read-only: this handler registers and deregisters watchers and nothing else. The clock
 * lives in {@code SessionManager} and the frames are built by {@link StateBroadcaster}, so
 * an inbound message from a client can never perturb the simulation.
 */
@Component
@EnableWebSocket
public class SessionSocketHandler extends TextWebSocketHandler implements WebSocketConfigurer {

    private final SessionRepository sessions;
    private final StateBroadcaster broadcaster;
    private final CorsConfig corsConfig;
    private final int textBufferBytes;

    public SessionSocketHandler(SessionRepository sessions, StateBroadcaster broadcaster,
                                CorsConfig corsConfig,
                                @Value("${session.socket-buffer-bytes:524288}") int textBufferBytes) {
        this.sessions = sessions;
        this.broadcaster = broadcaster;
        this.corsConfig = corsConfig;
        this.textBufferBytes = textBufferBytes;
    }

    /**
     * Raises the WebSocket text buffer well above the 8 KB servlet default.
     *
     * <p>This is not tuning, it is a correctness fix. A frame carrying hundreds of agent
     * positions runs to tens of kilobytes, and a frame over the limit does not truncate —
     * the container closes the connection. The default therefore drops every viewer at
     * precisely the moment the venue gets busy, which is the only moment anyone is watching.
     * Sized for {@code session.max-people-in-frame} agents with headroom.
     */
    @Bean
    public ServletServerContainerFactoryBean webSocketContainer(
            @Value("${session.socket-buffer-bytes:524288}") int bufferBytes) {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(bufferBytes);
        container.setMaxBinaryMessageBufferSize(bufferBytes);
        return container;
    }

    /**
     * Same origin list as the REST API. A WebSocket handshake is not covered by CORS, so
     * leaving this open while {@code cors.allowed-origins} is pinned would mean any page on
     * the internet could open a stream against a locally running backend.
     */
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(this, "/sessions/*/stream")
                .setAllowedOriginPatterns(corsConfig.getAllowedOrigins().toArray(String[]::new));
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession socket) {
        socket.setTextMessageSizeLimit(textBufferBytes);
        String sessionId = sessionIdOf(socket);
        broadcaster.register(sessionId, socket);
        // Push the current frame straight away so a late joiner never stares at a blank map.
        sessions.findById(sessionId).ifPresent(session -> broadcaster.sendLatest(session, socket));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession socket, CloseStatus status) {
        broadcaster.unregister(sessionIdOf(socket), socket);
    }

    /** /sessions/{id}/stream -> {id} */
    private String sessionIdOf(WebSocketSession socket) {
        String[] parts = socket.getUri().getPath().split("/");
        return parts.length >= 3 ? parts[2] : "";
    }
}
