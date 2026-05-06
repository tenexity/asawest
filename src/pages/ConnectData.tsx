import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, Download, Database, CheckCircle2, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type DatasetKey = "sales_history" | "inventory_snapshot" | "products";

const TEMPLATES: Record<DatasetKey, { headers: string[]; sample: string[][] }> = {
  sales_history: {
    headers: ["sale_date", "branch_id", "product_id", "quantity", "is_will_call", "customer_type"],
    sample: [
      ["2026-04-01", "<branch-uuid>", "<product-uuid>", "5", "false", "contractor"],
    ],
  },
  inventory_snapshot: {
    headers: ["branch_id", "product_id", "on_hand", "on_order", "allocated", "safety_stock", "reorder_point"],
    sample: [["<branch-uuid>", "<product-uuid>", "120", "0", "0", "20", "40"]],
  },
  products: {
    headers: [
      "sku",
      "description",
      "category",
      "subcategory",
      "unit_of_measure",
      "unit_cost",
      "unit_price",
      "abc_class",
      "xyz_class",
      "is_intermittent",
      "seasonality_pattern",
      "is_phase_down",
    ],
    sample: [
      [
        "CP-3/4-90-PVC",
        '3/4" 90° PVC elbow',
        "fittings",
        "elbows",
        "EA",
        "0.42",
        "1.20",
        "A",
        "X",
        "false",
        "none",
        "false",
      ],
    ],
  },
};

const ERPS = [
  {
    key: "p21",
    name: "Epicor Prophet 21",
    blurb: "Most-deployed ERP in plumbing & HVAC distribution.",
  },
  { key: "eclipse", name: "Epicor Eclipse", blurb: "Deep electrical/plumbing distribution coverage." },
  { key: "sxe", name: "Infor SX.e", blurb: "Wholesale distribution platform widely used in HVAC." },
  { key: "netsuite", name: "NetSuite", blurb: "Cloud ERP common at growing distributors." },
];

function downloadTemplate(key: DatasetKey) {
  const t = TEMPLATES[key];
  const csv = Papa.unparse({ fields: t.headers, data: t.sample });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${key}_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Dropzone({ dataset }: { dataset: DatasetKey }) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setErrors([]);
    setSuccess(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        const expected = TEMPLATES[dataset].headers;
        const headers = res.meta.fields ?? [];
        const missing = expected.filter((h) => !headers.includes(h));
        if (missing.length) {
          setErrors([`Missing required columns: ${missing.join(", ")}`]);
          setBusy(false);
          return;
        }
        const rows = res.data;
        if (rows.length === 0) {
          setErrors(["No rows found"]);
          setBusy(false);
          return;
        }
        // Note: writes are restricted by RLS for this preview build.
        const tableName =
          dataset === "inventory_snapshot" ? "inventory_levels" : dataset;
        const { error } = await supabase.from(tableName as never).insert(rows as never);
        if (error) {
          setErrors([
            `Upload blocked: ${error.message}. (CSV parsed OK — ${rows.length} rows ready.)`,
          ]);
        } else {
          setSuccess(`Uploaded ${rows.length} rows`);
          toast.success(`Uploaded ${rows.length} rows to ${tableName}`);
        }
        setBusy(false);
      },
      error: (err) => {
        setErrors([err.message]);
        setBusy(false);
      },
    });
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <div className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:bg-muted/40 transition">
          <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <div className="text-sm font-medium">
            Drop CSV or click to upload — {dataset.replace("_", " ")}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {busy ? "Processing…" : "First row must contain column headers"}
          </div>
          <input
            type="file"
            accept=".csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      </label>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => downloadTemplate(dataset)}
        >
          <Download className="h-3 w-3 mr-1" /> Template
        </Button>
        {success && (
          <span className="text-xs text-success inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> {success}
          </span>
        )}
      </div>
      {errors.map((e, i) => (
        <div
          key={i}
          className="text-xs text-danger inline-flex items-center gap-1 bg-danger/10 px-2 py-1 rounded"
        >
          <AlertCircle className="h-3 w-3" /> {e}
        </div>
      ))}
    </div>
  );
}

function ErpModal({
  open,
  onOpenChange,
  erp,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  erp: { name: string } | null;
}) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  if (!erp) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Native MCP connector for {erp.name}</DialogTitle>
          <DialogDescription>
            MCP (Model Context Protocol) is a universal connector standard — it lets FlowOps
            read and write your ERP without bespoke integration code, so onboarding takes
            hours instead of months.
          </DialogDescription>
        </DialogHeader>
        {submitted ? (
          <div className="text-sm text-success inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> You're on the early-access list.
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
          >
            <Input
              type="email"
              required
              placeholder="you@distributor.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit">Request access</Button>
          </form>
        )}
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectData() {
  const [erp, setErp] = useState<(typeof ERPS)[number] | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect Data</h1>
        <p className="text-sm text-muted-foreground">
          Upload CSVs to seed FlowOps, or request a native ERP connector.
        </p>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Upload CSV</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Dropzone dataset="sales_history" />
          <Dropzone dataset="inventory_snapshot" />
          <Dropzone dataset="products" />
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-1">Connect Your ERP</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Native MCP connectors — no custom integration code, no middleware.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ERPS.map((e) => (
            <button
              key={e.key}
              onClick={() => setErp(e)}
              className="text-left border rounded-md p-4 hover:border-primary hover:bg-muted/40 transition flex items-start gap-3"
            >
              <Database className="h-5 w-5 mt-0.5 text-muted-foreground" />
              <div>
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{e.blurb}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <ErpModal open={!!erp} onOpenChange={(v) => !v && setErp(null)} erp={erp} />
    </div>
  );
}
