-- Borang EA prints the employer's signing officer and position (auditor's sample, 15 October 2026).
ALTER TABLE "legal_employers" ADD COLUMN "ea_signer_name" TEXT;
ALTER TABLE "legal_employers" ADD COLUMN "ea_signer_position" TEXT;
