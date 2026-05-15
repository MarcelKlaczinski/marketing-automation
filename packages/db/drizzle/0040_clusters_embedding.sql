ALTER TABLE "clusters"
  ADD COLUMN "embedding" vector(1024);

CREATE INDEX "clusters_embedding_idx"
  ON "clusters" USING hnsw ("embedding" vector_cosine_ops);
