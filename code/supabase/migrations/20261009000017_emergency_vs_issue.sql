-- =====================================================================
-- AmarShohor — 0017: emergencies vs. issues
--
-- Rule: an emergency alert is for danger to people in the next minutes that
-- is over within hours (fire, gas leak, collapse under way, sparking wire,
-- people trapped, toxic fumes). An issue — even a critical one — is a
-- dangerous condition that stays until someone repairs it.
--
-- 1. emergency_label knows 'toxic_release'.
-- 2. Categories that sounded like emergencies are renamed to the condition
--    left behind, so citizens don't pick them for a live emergency.
-- 3. "Active Vandalism in Progress" was a police job (over before anyone
--    could validate it); it becomes "Vandalism Damage", a repair issue.
--    Existing issues keep the severity they were filed with.
-- =====================================================================

set search_path = public, extensions;

create or replace function emergency_label(p emergency_kind) returns text
language sql immutable as $$
  select case p when 'fire' then 'Fire' when 'gas_leak' then 'Gas leak' when 'building_collapse' then 'Building collapse'
                when 'live_wire' then 'Live electric wire' when 'flood_rescue' then 'People trapped by flooding'
                when 'toxic_release' then 'Chemical spill or toxic smoke'
                else 'Emergency' end
$$;

update categories set name = 'Downed / Hanging Power Line (not sparking)',
                      name_bn = 'ছিঁড়ে পড়া / ঝুলন্ত বিদ্যুতের তার (স্পার্ক নেই)'
 where slug = 'downed_power_line';
update categories set name = 'Exposed Electrical Wiring (not sparking)',
                      name_bn = 'খোলা বৈদ্যুতিক তার (স্পার্ক নেই)'
 where slug = 'exposed_wiring';
update categories set name = 'Structurally Unsafe Building (cracks, leaning)',
                      name_bn = 'ঝুঁকিপূর্ণ ভবন (ফাটল, হেলে পড়া)'
 where slug = 'unsafe_structure';
update categories set name = 'Chemical / Oil Spill (no fumes or fire)',
                      name_bn = 'রাসায়নিক / তেল ছড়িয়ে পড়া (ধোঁয়া বা আগুন নেই)'
 where slug = 'chemical_spill';
update categories set name = 'Vandalism Damage', name_bn = 'ভাঙচুরের ক্ষতি', default_severity = 'medium'
 where slug = 'active_vandalism';
