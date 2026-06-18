# L1 Transcript CSV Column Mapping

## Overview

Book1.csv contains **34 columns** with **AI-GENERATED tags already present** in columns 2-18. This means Phase 4 (AI tagging) should be adjusted to **USE existing tags** rather than regenerate them.

---

## Column Mapping (CSV → Database)

| CSV Column | Database Field | Type | Notes |
|---|---|---|
| 1. `interaction_id` | `interaction_id` | TEXT PRIMARY KEY | ✅ Direct match |
| 2. `conversation_summary` | `conversation_summary` | TEXT | ✅ ALREADY AI-GENERATED |
| 3. `potential_preventative_action` | `tags` (JSON) | JSON | ⚠️ Combine columns 3-18 into tags array |
| 4. `actionable_improvement_opportunity` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 5. `airo_product_line` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 6. `sub_intent` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 7. `issue_resolution` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 8. `customer_sentiment` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 9. `customer_sentiment_verbiage` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 10. `friction_point` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 11. `friction_point_verbiage` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 12. `inbound_volume_driver` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 13. `inbound_driver_verbiage` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 14. `sales_consultation` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 15. `conversion_signal` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 16. `related_to_known_issue` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 17. `preventable_contact` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 18. `market_region_signal` | `tags` (JSON) | JSON | ⚠️ Combine into tags |
| 19. `shopper_id` | `shopper_id` | TEXT NOT NULL | ✅ Direct match |
| 20. `customer_id` | `customer_id` | TEXT | ✅ Direct match |
| 21. `etl_build_mst_ts` | `created_at` | TIMESTAMP | ⚠️ Rename field |
| 22. `rpt_mst_date` | `updated_at` | TIMESTAMP | ⚠️ Rename field |
| 23. `run_id` | `raw_data` (JSON) | JSON | ⚠️ Store in raw_data |
| 24. `customer_type_name` | `raw_data` (JSON) | JSON | ⚠️ Store in raw_data |
| 25. `country` | `language` | TEXT | ⚠️ Map country → language |
| 26. `agent_skill_raw` | `agent_name` | TEXT | ⚠️ Rename field |
| 27. `handled_repeat_contact_platform` | `interaction_type` | TEXT | ⚠️ Rename field |
| 28. `agent_department` | `category` | TEXT | ⚠️ Rename field |
| 29. `call_type` | `subcategory` | TEXT | ⚠️ Rename field |
| 30. `care_contact_platform` | `raw_data` (JSON) | JSON | ⚠️ Store in raw_data |
| 31. `agent_skill_level` | `raw_data` (JSON) | JSON | ⚠️ Store in raw_data |
| 32. `repeat_contact` | `raw_data` (JSON) | JSON | ⚠️ Store in raw_data |
| 33. `transcript_viewer` | `source_s3_key` | TEXT | ⚠️ Store URL/path |
| 34. `full_transcript` | `full_transcript` | TEXT NOT NULL | ✅ Direct match |

---

## Tag Combination Strategy

Columns 3-18 should be **combined into a single JSON array** in the `tags` field:

```json
{
  "tags": [
    "potential_preventative_action:Clear in-product messaging...",
    "actionable_improvement_opportunity:Add an in-product banner...",
    "airo_product_line:Airo AI Builder",
    "sub_intent:Product Fit / Missing Feature",
    "issue_resolution:Yes",
    "customer_sentiment:Neutral",
    "customer_sentiment_verbiage:i find it very easy...",
    "friction_point:Product bug or error",
    "friction_point_verbiage:i'm having problems...",
    "inbound_volume_driver:Product Question/Configuration",
    "inbound_driver_verbiage:...",
    "sales_consultation:Yes",
    "conversion_signal:None",
    "related_to_known_issue:Yes",
    "preventable_contact:Yes",
    "market_region_signal:North America"
  ]
}
```

**Alternative:** Store as structured JSON object (better for querying):

```json
{
  "potential_preventative_action": "Clear in-product messaging...",
  "actionable_improvement_opportunity": "Add an in-product banner...",
  "airo_product_line": "Airo AI Builder",
  "sub_intent": "Product Fit / Missing Feature",
  "issue_resolution": "Yes",
  "customer_sentiment": "Neutral",
  "customer_sentiment_verbiage": "i find it very easy...",
  "friction_point": "Product bug or error",
  "friction_point_verbiage": "i'm having problems...",
  "inbound_volume_driver": "Product Question/Configuration",
  "inbound_driver_verbiage": "...",
  "sales_consultation": "Yes",
  "conversion_signal": "None",
  "related_to_known_issue": "Yes",
  "preventable_contact": "Yes",
  "market_region_signal": "North America"
}
```

**Recommendation:** Use structured JSON object for better query performance and filter UX.

---

## Missing Fields (Not in CSV)

These database fields have **no direct CSV mapping** and will need to be derived or left NULL:

| Database Field | Status | Solution |
|---|---|---|
| `app_id` | ❌ Not in CSV | Extract from transcript via AI (Phase 4) |
| `domain` | ❌ Not in CSV | Extract from transcript via AI (Phase 4) |
| `ingested_at` | — | Auto-generated (current timestamp) |
| `source_file_hash` | — | Auto-generated (SHA-256 of xlsx file) |
| `xlsx_row_index` | — | Auto-generated (row number in xlsx) |
| `interaction_status` | ❌ Not in CSV | Map from `issue_resolution` field (Yes → resolved, No → unresolved) |
| `resolution_time_seconds` | ❌ Not in CSV | Leave NULL (not available) |
| `sentiment_score` | ❌ Not in CSV | Derive from `customer_sentiment` (Positive → 0.8, Neutral → 0.5, Negative → 0.2) |

---

## Phase 2 Implementation Impact

**Phase 2 (Upload API & xlsx Processing)** needs to:

1. Parse all 34 columns from CSV/xlsx
2. Map columns directly (1, 2, 19, 20, 34)
3. Combine columns 3-18 into `tags` JSON
4. Map renamed fields (21→created_at, 22→updated_at, etc.)
5. Store unmapped columns in `raw_data` JSON
6. Generate auto fields (ingested_at, source_file_hash, xlsx_row_index)
7. Derive missing fields (interaction_status, sentiment_score)
8. **SKIP AI generation** since tags/summary already exist

---

## Phase 4 AI Tagging Adjustment

**Original Plan:** Generate tags, summary, app_id, domain for ALL rows.

**Revised Plan:**
- Tags & summary → **Use existing CSV columns** (columns 2-18)
- app_id & domain → **Only extract these 2 fields** from transcript
- Batch strategy: 10 rows per LLM call, only extract app_id and domain
- Much faster and cheaper!

---

## Sample Data (First Row)

```csv
801650354,
"Customer called asking whether the AI website builder (Airo) would incur additional charges...",
"Clear in-product messaging explaining that Airo AI Builder does not currently support commerce functionality...",
"Add an in-product banner or modal in Website + Marketing accounts...",
Airo AI Builder,
Product Fit / Missing Feature,
Yes,
Neutral,
"i find it very easy to work with you...",
Product bug or error,
"i'm having problems with my...",
Product Question/Configuration,
"...",
Yes,
None,
Yes,
Yes,
North America,
123456789,
987654321,
2024-06-11T12:00:00Z,
2024-06-11,
run_12345,
Existing Customer,
United States,
Websites_T2,
Phone,
Support,
Inbound,
Phone,
Level 2,
Yes,
https://secureservernet.sharepoint.com/...,
"Agent: Hi, thank you for contacting GoDaddy..."
```

---

## Next Steps

1. ✅ Phase 1: Database schema complete
2. 🚧 Phase 2: Update xlsx parser to use this column mapping
3. 🚧 Phase 4: Adjust AI tagging to ONLY extract app_id and domain
4. 🚧 Phase 5: Update Browse UI filters to use structured tags JSON
5. 🚧 Phase 6: Update Analysis tab to aggregate on tag fields
