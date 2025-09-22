import StatusBadge from '../StatusBadge';

export default function StatusBadgeExample() {
  return (
    <div className="flex gap-2 flex-wrap">
      <StatusBadge status="owned" />
      <StatusBadge status="wishlist" />
      <StatusBadge status="playing" />
      <StatusBadge status="completed" />
    </div>
  );
}