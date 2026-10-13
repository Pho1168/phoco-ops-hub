import Link from "next/link";
import { Icon } from "./Icon";

/** On Today and My shifts while someone has training overdue or to do again. */
export function TrainingDue({ overdue, again }: { overdue: number; again: number }) {
  if (!overdue && !again) return null;
  const parts = [overdue ? `${overdue} overdue` : "", again ? `${again} to do again` : ""].filter(Boolean).join(", ");
  return (
    <Link href="/library/training" className="alert" aria-label="Training to do" style={{ textDecoration: "none" }}>
      <Icon name="book" />
      <div className="grow">
        <div className="strong">Training: {parts}</div>
        <div style={{ fontSize: 13 }}>Open your training to see what&apos;s due.</div>
      </div>
    </Link>
  );
}
