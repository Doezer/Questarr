import { FaGithub, FaArrowUp } from "react-icons/fa";
import pkg from "../../../package.json";
import semver from "semver";
import { useLatestQuestarrVersion } from "@/hooks/use-latest-questarr-version";

interface GitHubVersionLinkProps {
  className?: string;
}

export function GitHubVersionLink({ className }: Readonly<GitHubVersionLinkProps>) {
  const latestVersion = useLatestQuestarrVersion();
  const hasNewerVersion =
    latestVersion && semver.valid(latestVersion) && semver.gt(latestVersion, pkg.version);

  return (
    <a
      href="https://github.com/Doezer/Questarr"
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "flex items-center gap-1.5 text-xs text-gray-400 hover:opacity-80 transition-opacity"
      }
    >
      <FaGithub size={14} />
      <span>Questarr v{pkg.version}</span>
      {hasNewerVersion && (
        <span className="text-emerald-500/70">
          v{latestVersion} <FaArrowUp className="inline" size={10} />
        </span>
      )}
    </a>
  );
}
