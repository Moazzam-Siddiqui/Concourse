# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
# Maven image rather than the ./mvnw wrapper: the wrapper's job is to give a checkout a Maven
# it can trust without one installed, and the image already is that.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# pom.xml alone first. Dependencies are the slow half of the build and they change far less
# often than source, so this layer stays cached across ordinary code edits.
COPY pom.xml .
RUN mvn -B -ntp dependency:go-offline

COPY src ./src

# Tests are skipped *here* on purpose. They run as their own Jenkins stage, where a failure is
# reported as a test failure rather than as an image that would not build, and where the report
# can be archived. Running them in both places doubles every build for no extra signal.
RUN mvn -B -ntp clean package -DskipTests

# ---- run ------------------------------------------------------------------
# JRE, not JDK: nothing compiles at runtime, and it is roughly a third of the size.
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Non-root. A container that only needs to read a jar and open a socket has no use for root,
# and this is the cheapest possible limit on what a compromise is worth.
RUN addgroup -S concourse && adduser -S -G concourse concourse

COPY --from=build /build/target/concourse-*.jar app.jar

# Writable for the default profile, which keeps its H2 file under ./data. The cloud profile
# used by docker-compose talks to Postgres and never touches this.
RUN mkdir -p /app/data && chown -R concourse:concourse /app
USER concourse

EXPOSE 8080

# start-period covers Spring's boot time, so a slow first start is not reported as unhealthy.
# wget is busybox's, already in the alpine base — no extra layer for curl.
HEALTHCHECK --interval=15s --timeout=3s --start-period=45s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
