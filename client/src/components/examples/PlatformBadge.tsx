import PlatformBadge from '../PlatformBadge';

export default function PlatformBadgeExample() {
  return (
    <div className="flex gap-2 flex-wrap">
      <PlatformBadge platform="PC" />
      <PlatformBadge platform="PlayStation" />
      <PlatformBadge platform="Xbox" />
      <PlatformBadge platform="Switch" />
      <PlatformBadge platform="Mobile" />
      <PlatformBadge platform="VR" />
    </div>
  );
}