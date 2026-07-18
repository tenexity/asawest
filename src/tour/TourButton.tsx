import { PlayCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "./TourProvider";

export function TourButton() {
  const { start, resume, active, hasSeen, savedStep } = useTour();
  if (active) return null;

  const canResume = savedStep !== null;

  if (canResume) {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          onClick={resume}
          className="bg-red-600 hover:bg-red-700 text-white border-transparent"
          data-tour="start-tour-btn"
        >
          <PlayCircle className="h-4 w-4 mr-1.5" />
          Resume tour
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={start}
          title="Restart from the beginning"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      onClick={start}
      className={`bg-red-600 hover:bg-red-700 text-white border-transparent ${hasSeen ? "" : "animate-pulse"}`}
      data-tour="start-tour-btn"
    >
      <PlayCircle className="h-4 w-4 mr-1.5" />
      {hasSeen ? "Replay tour" : "Take the tour"}
    </Button>
  );
}
