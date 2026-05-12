TRUNCATE TABLE
  public.sales_history,
  public.inventory_levels,
  public.purchase_order_items,
  public.purchase_orders,
  public.insights,
  public.transfer_orders,
  public.reorder_recommendations,
  public.markdown_candidates,
  public.saved_simulations,
  public.chat_messages,
  public.conversations,
  public.supplier_products,
  public.products,
  public.suppliers,
  public.customers,
  public.branches
RESTART IDENTITY CASCADE;