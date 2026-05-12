export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      action_audit_log: {
        Row: {
          action_payload: Json
          action_summary: string | null
          action_type: string
          created_at: string
          error_message: string | null
          financial_impact_usd: number
          id: string
          insight_id: string
          insight_title: string
          insight_type: string
          result_json: Json
          status: string
          user_id: string | null
        }
        Insert: {
          action_payload?: Json
          action_summary?: string | null
          action_type: string
          created_at?: string
          error_message?: string | null
          financial_impact_usd?: number
          id?: string
          insight_id: string
          insight_title: string
          insight_type: string
          result_json?: Json
          status?: string
          user_id?: string | null
        }
        Update: {
          action_payload?: Json
          action_summary?: string | null
          action_type?: string
          created_at?: string
          error_message?: string | null
          financial_impact_usd?: number
          id?: string
          insight_id?: string
          insight_title?: string
          insight_type?: string
          result_json?: Json
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      branches: {
        Row: {
          city: string
          climate_zone: Database["public"]["Enums"]["climate_zone"]
          id: string
          name: string
          opened_date: string
          state: string
        }
        Insert: {
          city: string
          climate_zone: Database["public"]["Enums"]["climate_zone"]
          id?: string
          name: string
          opened_date: string
          state: string
        }
        Update: {
          city?: string
          climate_zone?: Database["public"]["Enums"]["climate_zone"]
          id?: string
          name?: string
          opened_date?: string
          state?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tool_calls: Json
          user_id: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tool_calls?: Json
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tool_calls?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          assigned_branch_id: string | null
          id: string
          name: string
          type: Database["public"]["Enums"]["customer_type"]
        }
        Insert: {
          assigned_branch_id?: string | null
          id?: string
          name: string
          type: Database["public"]["Enums"]["customer_type"]
        }
        Update: {
          assigned_branch_id?: string | null
          id?: string
          name?: string
          type?: Database["public"]["Enums"]["customer_type"]
        }
        Relationships: [
          {
            foreignKeyName: "customers_assigned_branch_id_fkey"
            columns: ["assigned_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          created_at: string
          evidence_json: Json
          financial_impact_usd: number
          id: string
          narrative: string
          recommended_action_json: Json
          resolved_at: string | null
          severity: Database["public"]["Enums"]["insight_severity"]
          status: Database["public"]["Enums"]["insight_status"]
          title: string
          type: Database["public"]["Enums"]["insight_type"]
        }
        Insert: {
          created_at?: string
          evidence_json?: Json
          financial_impact_usd?: number
          id?: string
          narrative?: string
          recommended_action_json?: Json
          resolved_at?: string | null
          severity: Database["public"]["Enums"]["insight_severity"]
          status?: Database["public"]["Enums"]["insight_status"]
          title: string
          type: Database["public"]["Enums"]["insight_type"]
        }
        Update: {
          created_at?: string
          evidence_json?: Json
          financial_impact_usd?: number
          id?: string
          narrative?: string
          recommended_action_json?: Json
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["insight_severity"]
          status?: Database["public"]["Enums"]["insight_status"]
          title?: string
          type?: Database["public"]["Enums"]["insight_type"]
        }
        Relationships: []
      }
      inventory_levels: {
        Row: {
          allocated: number
          branch_id: string
          last_counted_at: string | null
          on_hand: number
          on_order: number
          product_id: string
          reorder_point: number
          safety_stock: number
        }
        Insert: {
          allocated?: number
          branch_id: string
          last_counted_at?: string | null
          on_hand?: number
          on_order?: number
          product_id: string
          reorder_point?: number
          safety_stock?: number
        }
        Update: {
          allocated?: number
          branch_id?: string
          last_counted_at?: string | null
          on_hand?: number
          on_order?: number
          product_id?: string
          reorder_point?: number
          safety_stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      markdown_candidates: {
        Row: {
          branch_id: string
          created_at: string
          estimated_value: number
          excess_qty: number
          id: string
          product_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          estimated_value?: number
          excess_qty: number
          id?: string
          product_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          estimated_value?: number
          excess_qty?: number
          id?: string
          product_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          abc_class: Database["public"]["Enums"]["abc_class"]
          category: Database["public"]["Enums"]["product_category"]
          description: string
          id: string
          is_intermittent: boolean
          is_phase_down: boolean
          seasonality_pattern: Database["public"]["Enums"]["seasonality_pattern"]
          sku: string
          subcategory: string | null
          substitute_product_id: string | null
          unit_cost: number
          unit_of_measure: string
          unit_price: number
          xyz_class: Database["public"]["Enums"]["xyz_class"]
        }
        Insert: {
          abc_class: Database["public"]["Enums"]["abc_class"]
          category: Database["public"]["Enums"]["product_category"]
          description: string
          id?: string
          is_intermittent?: boolean
          is_phase_down?: boolean
          seasonality_pattern?: Database["public"]["Enums"]["seasonality_pattern"]
          sku: string
          subcategory?: string | null
          substitute_product_id?: string | null
          unit_cost: number
          unit_of_measure: string
          unit_price: number
          xyz_class: Database["public"]["Enums"]["xyz_class"]
        }
        Update: {
          abc_class?: Database["public"]["Enums"]["abc_class"]
          category?: Database["public"]["Enums"]["product_category"]
          description?: string
          id?: string
          is_intermittent?: boolean
          is_phase_down?: boolean
          seasonality_pattern?: Database["public"]["Enums"]["seasonality_pattern"]
          sku?: string
          subcategory?: string | null
          substitute_product_id?: string | null
          unit_cost?: number
          unit_of_measure?: string
          unit_price?: number
          xyz_class?: Database["public"]["Enums"]["xyz_class"]
        }
        Relationships: [
          {
            foreignKeyName: "products_substitute_product_id_fkey"
            columns: ["substitute_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      promoted_substitutes: {
        Row: {
          product_id: string
          promoted_at: string
          substitute_product_id: string
        }
        Insert: {
          product_id: string
          promoted_at?: string
          substitute_product_id: string
        }
        Update: {
          product_id?: string
          promoted_at?: string
          substitute_product_id?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          id: string
          po_id: string
          product_id: string
          quantity: number
          unit_cost: number
        }
        Insert: {
          id?: string
          po_id: string
          product_id: string
          quantity: number
          unit_cost?: number
        }
        Update: {
          id?: string
          po_id?: string
          product_id?: string
          quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          branch_id: string
          expected_date: string
          id: string
          ordered_date: string
          received_date: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string
        }
        Insert: {
          branch_id: string
          expected_date: string
          id?: string
          ordered_date: string
          received_date?: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string
        }
        Update: {
          branch_id?: string
          expected_date?: string
          id?: string
          ordered_date?: string
          received_date?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      reorder_recommendations: {
        Row: {
          avg_daily_demand: number
          branch_id: string
          computed_at: string
          days_of_supply: number | null
          demand_stddev: number
          financial_impact: number
          id: string
          lead_time_days: number
          lead_time_var_days: number
          moq: number
          on_hand: number
          on_order: number
          product_id: string
          rebate_bumped_qty: number | null
          rebate_opportunity: boolean
          rebate_threshold: number | null
          recent_max_day: number
          reorder_point: number
          safety_stock: number
          seasonality_boost: boolean
          seasonality_pattern: string | null
          service_level: number
          snoozed_until: string | null
          status: Database["public"]["Enums"]["rec_status"]
          suggested_qty: number
          supplier_id: string | null
          unit_cost: number
          urgency: Database["public"]["Enums"]["urgency_level"]
          z_score: number
        }
        Insert: {
          avg_daily_demand?: number
          branch_id: string
          computed_at?: string
          days_of_supply?: number | null
          demand_stddev?: number
          financial_impact?: number
          id?: string
          lead_time_days?: number
          lead_time_var_days?: number
          moq?: number
          on_hand?: number
          on_order?: number
          product_id: string
          rebate_bumped_qty?: number | null
          rebate_opportunity?: boolean
          rebate_threshold?: number | null
          recent_max_day?: number
          reorder_point?: number
          safety_stock?: number
          seasonality_boost?: boolean
          seasonality_pattern?: string | null
          service_level?: number
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["rec_status"]
          suggested_qty?: number
          supplier_id?: string | null
          unit_cost?: number
          urgency: Database["public"]["Enums"]["urgency_level"]
          z_score?: number
        }
        Update: {
          avg_daily_demand?: number
          branch_id?: string
          computed_at?: string
          days_of_supply?: number | null
          demand_stddev?: number
          financial_impact?: number
          id?: string
          lead_time_days?: number
          lead_time_var_days?: number
          moq?: number
          on_hand?: number
          on_order?: number
          product_id?: string
          rebate_bumped_qty?: number | null
          rebate_opportunity?: boolean
          rebate_threshold?: number | null
          recent_max_day?: number
          reorder_point?: number
          safety_stock?: number
          seasonality_boost?: boolean
          seasonality_pattern?: string | null
          service_level?: number
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["rec_status"]
          suggested_qty?: number
          supplier_id?: string | null
          unit_cost?: number
          urgency?: Database["public"]["Enums"]["urgency_level"]
          z_score?: number
        }
        Relationships: []
      }
      sales_history: {
        Row: {
          branch_id: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          id: number
          is_will_call: boolean
          product_id: string
          quantity: number
          sale_date: string
        }
        Insert: {
          branch_id: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          id?: number
          is_will_call?: boolean
          product_id: string
          quantity: number
          sale_date: string
        }
        Update: {
          branch_id?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          id?: number
          is_will_call?: boolean
          product_id?: string
          quantity?: number
          sale_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_history_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_scenarios: {
        Row: {
          created_at: string
          id: string
          name: string
          snapshot_json: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          snapshot_json: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          snapshot_json?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      saved_simulations: {
        Row: {
          created_at: string
          delay_days: number
          id: string
          name: string
          result: Json
          supplier_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delay_days: number
          id?: string
          name: string
          result: Json
          supplier_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          delay_days?: number
          id?: string
          name?: string
          result?: Json
          supplier_id?: string
          user_id?: string
        }
        Relationships: []
      }
      supplier_products: {
        Row: {
          cost: number
          is_primary: boolean
          moq: number
          product_id: string
          supplier_id: string
          supplier_sku: string
        }
        Insert: {
          cost: number
          is_primary?: boolean
          moq: number
          product_id: string
          supplier_id: string
          supplier_sku: string
        }
        Update: {
          cost?: number
          is_primary?: boolean
          moq?: number
          product_id?: string
          supplier_id?: string
          supplier_sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          id: string
          lead_time_days: number
          lead_time_variability_days: number
          name: string
          payment_terms: string
          rebate_program_active: boolean
          reliability_score: number
        }
        Insert: {
          id?: string
          lead_time_days: number
          lead_time_variability_days: number
          name: string
          payment_terms: string
          rebate_program_active?: boolean
          reliability_score: number
        }
        Update: {
          id?: string
          lead_time_days?: number
          lead_time_variability_days?: number
          name?: string
          payment_terms?: string
          rebate_program_active?: boolean
          reliability_score?: number
        }
        Relationships: []
      }
      transfer_orders: {
        Row: {
          created_at: string
          dest_branch_id: string
          expected_arrival: string | null
          id: string
          product_id: string
          quantity: number
          source_branch_id: string
          status: Database["public"]["Enums"]["transfer_status"]
        }
        Insert: {
          created_at?: string
          dest_branch_id: string
          expected_arrival?: string | null
          id?: string
          product_id: string
          quantity: number
          source_branch_id: string
          status?: Database["public"]["Enums"]["transfer_status"]
        }
        Update: {
          created_at?: string
          dest_branch_id?: string
          expected_arrival?: string | null
          id?: string
          product_id?: string
          quantity?: number
          source_branch_id?: string
          status?: Database["public"]["Enums"]["transfer_status"]
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          demo_mode: boolean
          last_reset_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          demo_mode?: boolean
          last_reset_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          demo_mode?: boolean
          last_reset_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dashboard_summary: { Args: { p_branch_id?: string }; Returns: Json }
      exec_readonly_sql: { Args: { query: string }; Returns: Json }
      network_graph_data: { Args: never; Returns: Json }
    }
    Enums: {
      abc_class: "A" | "B" | "C"
      climate_zone: "cold" | "temperate" | "hot" | "freeze_prone"
      customer_type:
        | "contractor"
        | "walk_in"
        | "project"
        | "builder"
        | "service_company"
      insight_severity: "critical" | "high" | "medium" | "low"
      insight_status: "new" | "approved" | "rejected" | "snoozed" | "executed"
      insight_type:
        | "stockout_risk"
        | "excess_inventory"
        | "supplier_delay_impact"
        | "substitution_opportunity"
        | "rebate_opportunity"
        | "inter_branch_transfer"
      po_status: "pending" | "in_transit" | "received" | "late" | "draft"
      product_category:
        | "PVC"
        | "copper"
        | "PEX"
        | "water_heaters"
        | "refrigerants"
        | "HVAC_equipment"
        | "controls"
        | "service_parts"
        | "fittings"
        | "valves"
      rec_status: "open" | "approved" | "rejected" | "snoozed"
      seasonality_pattern:
        | "cooling_peak"
        | "heating_peak"
        | "freeze_event"
        | "none"
      transfer_status: "pending" | "in_transit" | "received" | "cancelled"
      urgency_level: "critical" | "high" | "medium" | "low"
      xyz_class: "X" | "Y" | "Z"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      abc_class: ["A", "B", "C"],
      climate_zone: ["cold", "temperate", "hot", "freeze_prone"],
      customer_type: [
        "contractor",
        "walk_in",
        "project",
        "builder",
        "service_company",
      ],
      insight_severity: ["critical", "high", "medium", "low"],
      insight_status: ["new", "approved", "rejected", "snoozed", "executed"],
      insight_type: [
        "stockout_risk",
        "excess_inventory",
        "supplier_delay_impact",
        "substitution_opportunity",
        "rebate_opportunity",
        "inter_branch_transfer",
      ],
      po_status: ["pending", "in_transit", "received", "late", "draft"],
      product_category: [
        "PVC",
        "copper",
        "PEX",
        "water_heaters",
        "refrigerants",
        "HVAC_equipment",
        "controls",
        "service_parts",
        "fittings",
        "valves",
      ],
      rec_status: ["open", "approved", "rejected", "snoozed"],
      seasonality_pattern: [
        "cooling_peak",
        "heating_peak",
        "freeze_event",
        "none",
      ],
      transfer_status: ["pending", "in_transit", "received", "cancelled"],
      urgency_level: ["critical", "high", "medium", "low"],
      xyz_class: ["X", "Y", "Z"],
    },
  },
} as const
