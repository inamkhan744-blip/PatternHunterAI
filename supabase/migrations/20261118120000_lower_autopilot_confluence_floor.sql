-- Lowers the Auto-Pilot minimum confluence floor from 80 to 70.
--
-- The worker and this validator previously refused anything below 80, so the UI
-- select could not offer a more active setting. The floor is intentionally still
-- enforced server-side; it is only the hard limit that moved down. Everything
-- else in the validator is unchanged.

CREATE OR REPLACE FUNCTION public.validate_auto_pilot_config(p_raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  out jsonb := '{}'::jsonb;
  syms text[];
  list jsonb;
  num numeric;
  text_value text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'config', out);
  END IF;

  IF jsonb_typeof(p_raw) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Auto-Pilot config must be a JSON object.');
  END IF;

  -- symbols
  IF p_raw ? 'symbols' THEN
    IF jsonb_typeof(p_raw -> 'symbols') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'symbols must be an array.');
    END IF;
    SELECT array_agg(DISTINCT upper(trim(value))) INTO syms
    FROM jsonb_array_elements_text(p_raw -> 'symbols') AS t(value)
    WHERE upper(trim(value)) ~ '^[A-Z0-9]{5,20}$';

    IF syms IS NULL OR cardinality(syms) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'symbols must contain at least one valid Binance symbol.');
    END IF;

    SELECT jsonb_agg(symbol) INTO list
    FROM (SELECT unnest(syms) AS symbol LIMIT 10) AS limited;
    out := out || jsonb_build_object('symbols', list);
  END IF;

  -- timeframe
  IF p_raw ? 'timeframe' THEN
    text_value := lower(trim(p_raw ->> 'timeframe'));
    IF text_value NOT IN ('15m', '30m', '1h', '4h') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'timeframe must be one of 15m, 30m, 1h, 4h.');
    END IF;
    out := out || jsonb_build_object('timeframe', text_value);
  END IF;

  -- marketType
  IF p_raw ? 'marketType' THEN
    text_value := p_raw ->> 'marketType';
    IF lower(text_value) = 'spot' THEN
      out := out || jsonb_build_object('marketType', 'Spot');
    ELSIF lower(text_value) = 'futures' THEN
      out := out || jsonb_build_object('marketType', 'Futures');
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'marketType must be Spot or Futures.');
    END IF;
  END IF;

  -- leverage
  IF p_raw ? 'leverage' THEN
    IF jsonb_typeof(p_raw -> 'leverage') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'leverage must be a number.');
    END IF;
    num := (p_raw ->> 'leverage')::numeric;
    IF num < 1 OR num > 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'leverage must be between 1 and 10.');
    END IF;
    out := out || jsonb_build_object('leverage', floor(num)::int);
  END IF;

  -- riskPercent (matches the UI slider range; the worker sizes risk from it)
  IF p_raw ? 'riskPercent' THEN
    IF jsonb_typeof(p_raw -> 'riskPercent') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'riskPercent must be a number.');
    END IF;
    num := (p_raw ->> 'riskPercent')::numeric;
    IF num < 0.25 OR num > 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'riskPercent must be between 0.25 and 5.');
    END IF;
    out := out || jsonb_build_object('riskPercent', num);
  END IF;

  -- maxOpenTrades
  IF p_raw ? 'maxOpenTrades' THEN
    IF jsonb_typeof(p_raw -> 'maxOpenTrades') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxOpenTrades must be a number.');
    END IF;
    num := (p_raw ->> 'maxOpenTrades')::numeric;
    IF num < 1 OR num > 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxOpenTrades must be between 1 and 5.');
    END IF;
    out := out || jsonb_build_object('maxOpenTrades', floor(num)::int);
  END IF;

  -- tradeDirectionMode
  IF p_raw ? 'tradeDirectionMode' THEN
    text_value := upper(trim(p_raw ->> 'tradeDirectionMode'));
    IF text_value NOT IN ('BOTH', 'LONG_ONLY', 'SHORT_ONLY') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tradeDirectionMode is invalid.');
    END IF;
    out := out || jsonb_build_object('tradeDirectionMode', text_value);
  END IF;

  -- minScore: never below the server's safety floor (70 since this migration).
  IF p_raw ? 'minScore' THEN
    IF jsonb_typeof(p_raw -> 'minScore') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'minScore must be a number.');
    END IF;
    num := (p_raw ->> 'minScore')::numeric;
    IF num < 70 OR num > 100 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'minScore must be between 70 and 100.');
    END IF;
    out := out || jsonb_build_object('minScore', round(num)::int);
  END IF;

  -- maxDailyLossPercent: server-side daily circuit breaker.
  IF p_raw ? 'maxDailyLossPercent' THEN
    IF jsonb_typeof(p_raw -> 'maxDailyLossPercent') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxDailyLossPercent must be a number.');
    END IF;
    num := (p_raw ->> 'maxDailyLossPercent')::numeric;
    IF num < 1 OR num > 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxDailyLossPercent must be between 1 and 10.');
    END IF;
    out := out || jsonb_build_object('maxDailyLossPercent', num);
  END IF;

  -- paperTrading is deliberately strict: only a real boolean can select live.
  IF p_raw ? 'paperTrading' THEN
    IF jsonb_typeof(p_raw -> 'paperTrading') <> 'boolean' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'paperTrading must be a boolean.');
    END IF;
    out := out || jsonb_build_object('paperTrading', (p_raw ->> 'paperTrading')::boolean);
  END IF;

  -- Boolean Auto-Pilot edge filters.
  FOREACH text_value IN ARRAY ARRAY['volatilityScaling', 'adaptiveSizing', 'avoidWeekends', 'correlationFilter', 'rangeScalperEnabled'] LOOP
    IF p_raw ? text_value THEN
      IF jsonb_typeof(p_raw -> text_value) <> 'boolean' THEN
        RETURN jsonb_build_object('ok', false, 'error', text_value || ' must be a boolean.');
      END IF;
      out := out || jsonb_build_object(text_value, (p_raw ->> text_value)::boolean);
    END IF;
  END LOOP;

  -- minAdx
  IF p_raw ? 'minAdx' THEN
    IF jsonb_typeof(p_raw -> 'minAdx') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'minAdx must be a number.');
    END IF;
    num := (p_raw ->> 'minAdx')::numeric;
    IF num < 0 OR num > 50 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'minAdx must be between 0 and 50.');
    END IF;
    out := out || jsonb_build_object('minAdx', round(num)::int);
  END IF;

  -- sessionUtcStart / sessionUtcEnd
  IF p_raw ? 'sessionUtcStart' THEN
    IF jsonb_typeof(p_raw -> 'sessionUtcStart') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sessionUtcStart must be a number.');
    END IF;
    num := (p_raw ->> 'sessionUtcStart')::numeric;
    IF num < 0 OR num > 23 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sessionUtcStart must be between 0 and 23.');
    END IF;
    out := out || jsonb_build_object('sessionUtcStart', round(num)::int);
  END IF;
  IF p_raw ? 'sessionUtcEnd' THEN
    IF jsonb_typeof(p_raw -> 'sessionUtcEnd') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sessionUtcEnd must be a number.');
    END IF;
    num := (p_raw ->> 'sessionUtcEnd')::numeric;
    IF num < 1 OR num > 24 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sessionUtcEnd must be between 1 and 24.');
    END IF;
    out := out || jsonb_build_object('sessionUtcEnd', round(num)::int);
  END IF;

  -- maxConsecutiveLosses
  IF p_raw ? 'maxConsecutiveLosses' THEN
    IF jsonb_typeof(p_raw -> 'maxConsecutiveLosses') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxConsecutiveLosses must be a number.');
    END IF;
    num := (p_raw ->> 'maxConsecutiveLosses')::numeric;
    IF num < 0 OR num > 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxConsecutiveLosses must be between 0 and 10.');
    END IF;
    out := out || jsonb_build_object('maxConsecutiveLosses', round(num)::int);
  END IF;

  -- lossCooldownMinutes
  IF p_raw ? 'lossCooldownMinutes' THEN
    IF jsonb_typeof(p_raw -> 'lossCooldownMinutes') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'lossCooldownMinutes must be a number.');
    END IF;
    num := (p_raw ->> 'lossCooldownMinutes')::numeric;
    IF num < 0 OR num > 1440 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'lossCooldownMinutes must be between 0 and 1440.');
    END IF;
    out := out || jsonb_build_object('lossCooldownMinutes', round(num)::int);
  END IF;

  RETURN jsonb_build_object('ok', true, 'config', out);
END;
$$;
