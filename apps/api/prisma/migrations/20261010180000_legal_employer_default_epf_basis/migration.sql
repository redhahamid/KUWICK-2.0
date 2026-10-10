-- The employer's EPF basis for new staff (UAT, 10 October 2026). Every
-- existing employer keeps today's behaviour: all EPF-liable pay.
ALTER TABLE "legal_employers" ADD COLUMN "default_epf_basis" "ContributionBasisMode" NOT NULL DEFAULT 'ALL_APPLICABLE';
