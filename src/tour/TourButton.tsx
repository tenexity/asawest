import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "./TourProvider";

export function TourButton() {
  const { start, active, hasSeen } = useTour();
  if (active) return null;
  return (
    <Button
      size="sm"
      variant={hasSeen ? "outline" : "default"}
      onClick={start}
      className={hasSeen ? "" : "animate-pulse"}
      data-tour="start-tour-btn"
    >
      <PlayCircle className="h-4 w-4 mr-1.5" />
      {hasSeen ? "Replay tour" : "Take the tour"}
    </Button>
  );
}
