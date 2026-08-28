package com.concourse;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * End-to-end checks over the HTTP API, through the real application context.
 *
 * <p>Runs on a real servlet container ({@code RANDOM_PORT}) rather than the default mock one.
 * That is not a preference: {@code SessionSocketHandler} declares a
 * {@code ServletServerContainerFactoryBean}, and that bean can only be built when a genuine
 * {@code jakarta.websocket.server.ServerContainer} is present in the servlet context. Under
 * the mock environment there is none, so the whole context fails to load and every test in
 * the class errors before it runs. MockMvc still works against this setup.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
/**
 * Runs as an authorised CLIENT.
 *
 * These cases predate authentication and are about simulation behaviour, not access control,
 * so they assert against an authenticated caller rather than re-testing the security rules in
 * every method. The rules themselves are covered by AuthApiTest. Using @WithMockUser rather
 * than disabling security keeps the filter chain in the path, so a change that breaks
 * authorisation still shows up here as a 403.
 */
@WithMockUser(roles = "CLIENT")
class SimulationApiTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void venueSimulationAndReadEndpointsWork() throws Exception {
        String venue = """
                {
                  "id": "api-test-venue",
                  "name": "API Test Venue",
                  "nodes": [
                    { "id": "gate", "name": "Gate", "type": "GATE", "capacity": 100, "x": 0, "y": 0 },
                    { "id": "walk", "name": "Walk", "type": "WALKWAY", "capacity": 200, "x": 10, "y": 0 },
                    { "id": "exit", "name": "Exit", "type": "EXIT", "capacity": 100, "x": 20, "y": 0 }
                  ],
                  "edges": [
                    { "from": "gate", "to": "walk", "length": 10, "width": 5, "bidirectional": true },
                    { "from": "walk", "to": "exit", "length": 10, "width": 5, "bidirectional": true }
                  ]
                }
                """;

        mvc.perform(post("/venues")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(venue))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("api-test-venue"));

        String request = """
                {
                  "venueId": "api-test-venue",
                  "crowdSize": 200,
                  "ticks": 10,
                  "arrivalRate": 30,
                  "rerouteEnabled": true
                }
                """;

        String simulationJson = mvc.perform(post("/simulations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").exists())
                .andReturn()
                .getResponse()
                .getContentAsString();

        String simulationId = simulationJson.replaceAll(
                ".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mvc.perform(get("/simulations/{id}/state", simulationId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.simulationId").value(simulationId))
                .andExpect(jsonPath("$.nodes").isArray());

        mvc.perform(get("/simulations/{id}/alerts", simulationId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());

        mvc.perform(get("/simulations/{id}/advisories", simulationId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());

        mvc.perform(get("/simulations/{id}/summary", simulationId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.simulationId").value(simulationId));
    }

    /**
     * The attendee-facing route lookup. Asserts it walks the graph rather than answering with
     * the destination alone — the map draws the whole path, so a bare endpoint is not enough.
     */
    @Test
    void routeEndpointReturnsThePathToTheNearestExit() throws Exception {
        mvc.perform(post("/venues").contentType(MediaType.APPLICATION_JSON).content("""
                {
                  "id": "route-test-venue",
                  "name": "Route Test Venue",
                  "nodes": [
                    { "id": "gate", "name": "Gate", "type": "GATE", "capacity": 100, "x": 0, "y": 0 },
                    { "id": "walk", "name": "Walk", "type": "WALKWAY", "capacity": 200, "x": 10, "y": 0 },
                    { "id": "exit", "name": "Exit", "type": "EXIT", "capacity": 100, "x": 20, "y": 0 }
                  ],
                  "edges": [
                    { "from": "gate", "to": "walk", "length": 10, "width": 5, "bidirectional": true },
                    { "from": "walk", "to": "exit", "length": 10, "width": 5, "bidirectional": true }
                  ]
                }
                """))
                .andExpect(status().isCreated());

        mvc.perform(get("/venues/{id}/route", "route-test-venue").param("from", "gate"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.toNodeId").value("exit"))
                .andExpect(jsonPath("$.path").isArray())
                .andExpect(jsonPath("$.path[0]").value("gate"))
                .andExpect(jsonPath("$.path[1]").value("walk"))
                .andExpect(jsonPath("$.path[2]").value("exit"))
                .andExpect(jsonPath("$.cost").value(20.0));

        mvc.perform(get("/venues/{id}/route", "route-test-venue").param("from", "nowhere"))
                .andExpect(status().isNotFound());
    }

    /**
     * Both upload doors must apply the same rules. This is the regression that mattered: the
     * two paths once disagreed about whether an EXIT was required, so the same file was
     * accepted through /sessions and rejected through /venues.
     */
    @Test
    void bothUploadPathsAgreeOnWhatAValidVenueIs() throws Exception {
        String noExit = """
                {
                  "name": "No Exit Venue",
                  "nodes": [
                    { "id": "gate", "name": "Gate", "type": "GATE", "capacity": 100, "x": 0, "y": 0 },
                    { "id": "walk", "name": "Walk", "type": "WALKWAY", "capacity": 200, "x": 10, "y": 0 }
                  ],
                  "edges": [
                    { "from": "gate", "to": "walk", "length": 10, "width": 5, "bidirectional": true }
                  ]
                }
                """;

        // A venue with no EXIT is legal on both paths: it is a scenario worth simulating.
        mvc.perform(post("/venues").contentType(MediaType.APPLICATION_JSON).content(noExit))
                .andExpect(status().isCreated());
        mvc.perform(post("/sessions").contentType(MediaType.APPLICATION_JSON).content("""
                { "venue": %s, "crowdSize": 50, "arrivalRate": 5 }
                """.formatted(noExit)))
                .andExpect(status().isCreated());

        String noGate = """
                {
                  "name": "No Gate Venue",
                  "nodes": [
                    { "id": "walk", "name": "Walk", "type": "WALKWAY", "capacity": 200, "x": 0, "y": 0 },
                    { "id": "exit", "name": "Exit", "type": "EXIT", "capacity": 100, "x": 10, "y": 0 }
                  ],
                  "edges": [
                    { "from": "walk", "to": "exit", "length": 10, "width": 5, "bidirectional": true }
                  ]
                }
                """;

        // A venue with no GATE is rejected on both: nobody can ever enter it.
        mvc.perform(post("/venues").contentType(MediaType.APPLICATION_JSON).content(noGate))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/sessions").contentType(MediaType.APPLICATION_JSON).content("""
                { "venue": %s, "crowdSize": 50, "arrivalRate": 5 }
                """.formatted(noGate)))
                .andExpect(status().isBadRequest());
    }

    /** A dangling edge must be caught at upload, not deep inside the simulation. */
    @Test
    void rejectsAnEdgePointingAtANodeThatDoesNotExist() throws Exception {
        mvc.perform(post("/venues").contentType(MediaType.APPLICATION_JSON).content("""
                {
                  "name": "Dangling Edge Venue",
                  "nodes": [
                    { "id": "gate", "name": "Gate", "type": "GATE", "capacity": 100, "x": 0, "y": 0 },
                    { "id": "exit", "name": "Exit", "type": "EXIT", "capacity": 100, "x": 10, "y": 0 }
                  ],
                  "edges": [
                    { "from": "gate", "to": "ghost", "length": 10, "width": 5, "bidirectional": true }
                  ]
                }
                """))
                .andExpect(status().isBadRequest());
    }
}