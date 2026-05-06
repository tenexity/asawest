import { Card } from "@/components/ui/card";

export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">Coming soon.</p>
      </div>
      <Card className="p-10 text-center text-sm text-muted-foreground border-dashed">
        This view is reserved for the {title.toLowerCase()} module.
      </Card>
    </div>
  );
}
