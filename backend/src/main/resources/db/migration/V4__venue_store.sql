-- Venues, for deployments where the filesystem does not survive a restart.
--
-- Locally FileVenueRepository writes one JSON file per venue and that is fine: the disk is
-- still there tomorrow. On a container host with an ephemeral filesystem — every free tier,
-- and most paid ones without a mounted volume — that disk is wiped on each restart, deploy
-- and wake-from-idle. A client would upload a floor plan, hand out its venue code, and find
-- the venue gone the next time the service came back.
--
-- The payload stays JSON rather than being decomposed into tables. A venue is a nested graph
-- of zones, edges and points that only ever moves as a whole: nothing queries inside it, and
-- normalising it would buy joins nobody makes at the cost of a migration every time the model
-- gains a field. The id is lifted out because that is the one thing lookups use.
CREATE TABLE IF NOT EXISTS venue (
    id          VARCHAR(64)  PRIMARY KEY,
    payload     TEXT         NOT NULL,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
