ALTER TABLE magic_links ADD COLUMN code_digest TEXT CHECK (
  code_digest IS NULL OR (
    length(code_digest) = 64 AND code_digest NOT GLOB '*[^0-9a-f]*'
  )
);

ALTER TABLE magic_links ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0 CHECK (
  code_attempts >= 0
);
