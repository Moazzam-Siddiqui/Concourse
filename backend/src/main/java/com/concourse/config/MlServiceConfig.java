package com.concourse.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Points at the self-hosted FastAPI ml-service, bound from the {@code ml-service.*} block
 * in application.yml. Replaces the earlier Hugging Face Inference API client — the models
 * now run in a local process, so there is no token and no external call at inference time.
 *
 * <p>{@code mock-enabled: true} forces the deterministic mocks without the service running.
 */
@Configuration
@ConfigurationProperties(prefix = "ml-service")
public class MlServiceConfig {

    /**
     * Shared secret presented to the AI service as {@code X-Service-Token}.
     *
     * Empty by default so a clean checkout runs with no configuration, matching the AI
     * service's own behaviour. Set {@code ML_SERVICE_TOKEN} on both sides together: setting
     * it on only one of them means every inference call is refused.
     */
    private String serviceToken = "";

    private String baseUrl = "http://localhost:8000";
    private String riskPath = "/predict/risk";
    private String advisoryPath = "/generate/advisory";
    private String analyzePath = "/analyze";
    private String healthPath = "/health";
    private boolean mockEnabled = false;
    private int timeoutMs = 4000;
    /** /analyze fans out to two Hugging Face endpoints, so it gets a much longer rope. */
    private int analyzeTimeoutMs = 20_000;

    public String riskUrl() {
        return baseUrl + riskPath;
    }

    public String advisoryUrl() {
        return baseUrl + advisoryPath;
    }

    public String analyzeUrl() {
        return baseUrl + analyzePath;
    }

    public String healthUrl() {
        return baseUrl + healthPath;
    }

    @Bean
    public RestClient mlServiceRestClient() {
        return restClient(timeoutMs);
    }

    /**
     * Separate client for {@code /analyze}. Sharing the 4-second one would time out on a cold
     * Hugging Face endpoint every time, which reads as "the AI layer is broken" when it is
     * only warming up.
     */
    @Bean
    public RestClient analyzeRestClient() {
        return restClient(analyzeTimeoutMs);
    }

    private RestClient restClient(int millis) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(Math.min(millis, 5_000)));
        factory.setReadTimeout(Duration.ofMillis(millis));

        RestClient.Builder builder = RestClient.builder().requestFactory(factory);
        // Presented to the AI service on every call. It is the only thing separating "the
        // backend asked for an inference" from "anyone who can reach port 8000 did". Blank
        // means the shared secret is unconfigured on both sides, which is the supported
        // local-development state; the AI service warns about it at startup rather than
        // failing, so sending an empty header here would be noise.
        if (serviceToken != null && !serviceToken.isBlank()) {
            builder = builder.defaultHeader("X-Service-Token", serviceToken);
        }
        return builder.build();
    }

    public String getServiceToken() { return serviceToken; }
    public void setServiceToken(String serviceToken) { this.serviceToken = serviceToken; }
    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
    public String getRiskPath() { return riskPath; }
    public void setRiskPath(String riskPath) { this.riskPath = riskPath; }
    public String getAdvisoryPath() { return advisoryPath; }
    public void setAdvisoryPath(String advisoryPath) { this.advisoryPath = advisoryPath; }
    public String getAnalyzePath() { return analyzePath; }
    public void setAnalyzePath(String analyzePath) { this.analyzePath = analyzePath; }
    public int getAnalyzeTimeoutMs() { return analyzeTimeoutMs; }
    public void setAnalyzeTimeoutMs(int analyzeTimeoutMs) { this.analyzeTimeoutMs = analyzeTimeoutMs; }
    public String getHealthPath() { return healthPath; }
    public void setHealthPath(String healthPath) { this.healthPath = healthPath; }
    public boolean isMockEnabled() { return mockEnabled; }
    public void setMockEnabled(boolean mockEnabled) { this.mockEnabled = mockEnabled; }
    public int getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; }
}
