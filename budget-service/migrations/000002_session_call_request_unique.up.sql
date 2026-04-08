ALTER TABLE public.budget_session_items
  ADD CONSTRAINT budget_session_items_session_call_request_unique UNIQUE (session_id, call_request_id);
