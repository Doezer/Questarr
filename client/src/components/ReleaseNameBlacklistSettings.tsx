import React, { useState, useEffect } from "react";
import { Ban } from "lucide-react";
import TagListSettingsCard from "@/components/TagListSettingsCard";
import BlacklistedReleasesList from "@/components/BlacklistedReleasesList";

interface ReleaseNameBlacklistSettingsProps {
  blacklistTerms: string[];
  onTermsChange: (terms: string[]) => void;
}

/**
 * Settings card for everything that hides releases: the global list of name terms, and the
 * specific releases blacklisted per game from the download dialog.
 */
export default function ReleaseNameBlacklistSettings({
  blacklistTerms,
  onTermsChange,
}: Readonly<ReleaseNameBlacklistSettingsProps>) {
  const [terms, setTerms] = useState<string[]>(blacklistTerms);

  useEffect(() => {
    setTerms(blacklistTerms);
  }, [blacklistTerms]);

  useEffect(() => {
    onTermsChange(terms);
  }, [terms, onTermsChange]);

  return (
    <TagListSettingsCard
      icon={Ban}
      title="Release Blacklist"
      description="Releases hidden from search results and never auto-downloaded. Terms hide any release whose name contains them, across manual search, auto-search and AI-assisted results (case-insensitive, matched anywhere in the name)."
      tags={terms}
      onTagsChange={setTerms}
      editor={{
        inputId: "blacklist-term-input",
        label: "Blacklisted Terms",
        placeholder: "e.g. HYPERVISOR, CAM, SAMPLE...",
        helperText: "Press Enter or click + to add a term. Comparison is case-insensitive.",
        emptyText: "No blacklisted terms configured. All release names will be considered.",
        addAriaLabel: "Add blacklisted term",
        removeAriaLabel: (term) => `Remove ${term}`,
      }}
      buildPayload={() => ({ releaseNameBlacklist: JSON.stringify(terms) })}
      successTitle="Release Blacklist Saved"
      successDescription="Your blacklisted release name terms have been saved."
      saveLabel="Save Blacklist"
      onReset={() => setTerms([])}
      footer={<BlacklistedReleasesList />}
    />
  );
}
