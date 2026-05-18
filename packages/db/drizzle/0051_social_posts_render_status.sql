-- Spec 57.2: async Remotion render via BullMQ
-- Adds render lifecycle columns to social_posts (orthogonal to content-lifecycle `status`)

CREATE TYPE social_render_status AS ENUM ('pending', 'rendering', 'rendered', 'failed');

ALTER TABLE social_posts
  ADD COLUMN render_status social_render_status NOT NULL DEFAULT 'pending',
  ADD COLUMN render_job_id text,
  ADD COLUMN render_started_at timestamp with time zone,
  ADD COLUMN render_completed_at timestamp with time zone,
  ADD COLUMN render_error jsonb;

-- Backfill: existing rows already have rendered slides — mark them done
UPDATE social_posts
SET render_status = 'rendered',
    render_completed_at = updated_at
WHERE content->'slides' IS NOT NULL
  AND jsonb_typeof(content->'slides') = 'array'
  AND jsonb_array_length(content->'slides') > 0;

-- Partial index for "find active renders" queries (excludes the vast majority of completed rows)
CREATE INDEX social_posts_render_status_idx ON social_posts(render_status)
  WHERE render_status IN ('pending', 'rendering');
