-- Spec 54.5: add voyage AI to cost_service enum (used by adapter-voyage for embedding tracking)
ALTER TYPE "cost_service" ADD VALUE IF NOT EXISTS 'voyage';
