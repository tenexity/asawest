TRUNCATE sales_history, supplier_products, inventory_levels, purchase_orders, customers RESTART IDENTITY CASCADE;
UPDATE products SET substitute_product_id = NULL;
DELETE FROM products;
DELETE FROM suppliers;
DELETE FROM branches;