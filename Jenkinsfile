// CI/CD for the Concourse.
//
// Runs on the Jenkins defined in ci/jenkins/ — an image that carries JDK 21, Maven, Node 22,
// Python 3.11 and a Docker CLI. The toolchains are in the agent rather than in per-stage
// containers on purpose; see the note at the top of ci/jenkins/Dockerfile for why a mounted
// Docker socket makes the per-stage approach quietly mount nothing.
//
// Order is cheapest-signal-first: the three test stages fail in seconds to a couple of minutes,
// so a broken commit does not wait on an image build to be told it is broken.

pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
        // Two builds sharing a Docker daemon and a Maven repo is a race worth not having.
        disableConcurrentBuilds()
    }

    environment {
        // Per-build project name, so a smoke stack can never adopt or tear down the containers
        // from a developer's own `docker compose up` on the same machine.
        COMPOSE_PROJECT_NAME = "concourse-ci-${env.BUILD_NUMBER}"

        // Non-default host ports for the same reason: CI publishing on 8080 would collide with
        // the backend someone is running while they wait for this build.
        POSTGRES_PORT = '15432'
        AI_PORT       = '18000'
        BACKEND_PORT  = '18080'
        FRONTEND_PORT = '15173'

        // The cloud profile refuses to boot on the committed development secret. This one is
        // CI-only and worth nothing outside it.
        AUTH_JWT_SECRET = 'jenkins-ci-only-secret-not-a-deployment-key-0000'

        // Inside the jenkins_home volume, so dependencies survive between builds instead of
        // being re-downloaded into a workspace that gets wiped.
        MAVEN_REPO = '/var/jenkins_home/.m2/repository'
    }

    stages {
        stage('Backend tests') {
            steps {
                dir('backend') {
                    sh 'mvn -B -ntp -Dmaven.repo.local=$MAVEN_REPO test'
                }
            }
            post {
                always {
                    junit testResults: 'backend/target/surefire-reports/*.xml',
                          allowEmptyResults: false
                }
            }
        }

        stage('AI service tests') {
            steps {
                dir('ai-service') {
                    // pytest is not in requirements.txt — the service genuinely does not need
                    // it, and keeping the runtime dependency list honest is worth one line here.
                    // The layout extras are installed so the 21 pipeline tests actually run
                    // rather than skipping into a false pass.
                    sh '''
                        set -e
                        python3 -m venv .venv-ci
                        .venv-ci/bin/pip install --quiet --upgrade pip
                        .venv-ci/bin/pip install --quiet -r requirements.txt \
                                                         -r requirements-layout.txt \
                                                         pytest
                        .venv-ci/bin/python -m pytest tests -q --junitxml=pytest-results.xml
                        .venv-ci/bin/python -m app.scoring
                    '''
                }
            }
            post {
                always {
                    junit testResults: 'ai-service/pytest-results.xml',
                          allowEmptyResults: false
                }
            }
        }

        stage('Frontend tests') {
            steps {
                dir('frontend') {
                    // npm ci, not install: fails on a lockfile that has drifted from
                    // package.json rather than quietly resolving something else.
                    sh '''
                        set -e
                        npm ci
                        npm test
                        npm run test:render
                    '''
                }
            }
        }

        stage('Build images') {
            steps {
                sh 'docker compose build'
            }
        }

        stage('Stack smoke test') {
            steps {
                // --wait blocks until every service reports healthy and fails the build if any
                // does not. That turns each service's HEALTHCHECK into the assertion, so this
                // stage proves the containers actually serve rather than merely start — a
                // Spring app that dies in Flyway still "starts" for several seconds.
                sh '''
                    set -e
                    docker compose up -d --wait
                    docker compose ps
                '''
            }
            post {
                always {
                    // Logs before teardown; after `down` there is nothing left to ask.
                    sh 'docker compose logs --no-color --tail=300 > compose-logs.txt || true'
                    archiveArtifacts artifacts: 'compose-logs.txt', allowEmptyArchive: true
                    sh 'docker compose down -v --remove-orphans || true'
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}
