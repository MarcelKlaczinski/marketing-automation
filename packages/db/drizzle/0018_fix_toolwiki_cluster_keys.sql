-- Spec 49a.fix Section B: korrigiere veraltete cluster_key in toolwiki DE-Tool-Files
-- Diese Korruption entstand durch FilterChangedFiles Skip-Gate trotz Frontmatter-Cleanup

-- 1. musikgenerierung-2026 → music-generation-2026 (3 DE-Files: stable-audio, suno, udio)
UPDATE articles
SET cluster_key = 'music-generation-2026',
    updated_at = NOW()
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND collection = 'tools'
  AND locale = 'de'
  AND cluster_key = 'musikgenerierung-2026';

-- 2. wissensmanagement-2026 → knowledge-management-2026 (4 DE-Files: mem-ai, notion-ai, reflect, tana)
UPDATE articles
SET cluster_key = 'knowledge-management-2026',
    updated_at = NOW()
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND collection = 'tools'
  AND locale = 'de'
  AND cluster_key = 'wissensmanagement-2026';

-- 3. cursor-vs-windsurf-vs-codeium-2026 → cluster_role 'hub' (2 Files: de + en)
UPDATE articles
SET cluster_role = 'hub',
    updated_at = NOW()
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND collection = 'comparisons'
  AND slug = 'cursor-vs-windsurf-vs-codeium-2026'
  AND cluster_role = 'spoke';

-- Side-effect: articles.cluster_id will be re-assigned correctly by SyncClusters
-- when Section E runs the forceAll re-import.
