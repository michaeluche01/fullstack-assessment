-- Migration: add UNIQUE constraint on payment_events.provider_event_id
-- This is a second line of defence — the application checks for duplicates
-- first, but this constraint guarantees uniqueness at the DB level even
-- if two requests slip through the application check simultaneously.
ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_provider_event_id_unique
  UNIQUE (provider_event_id);