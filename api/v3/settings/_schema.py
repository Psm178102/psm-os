"""
Schema fixo dos settings PSM. Definido aqui pra:
- whitelist de chaves (rejeita inputs inesperados)
- masking de secrets (oculta valor sensível em GET)
- agrupamento por categoria pra UI

Não importar via Vercel route — só usado por list.py e upsert.py.
Por isso o prefix _ (Vercel ignora arquivos com underscore).
"""

# (key, label, category, is_secret, placeholder)
SETTINGS_SCHEMA = [
    # RD Station
    ("rd_crm_token",           "RD CRM · Token API",          "rd",       True,  "Ex: 6823d1aa..."),
    ("rd_mkt_client_id",       "RD MKT · Client ID",          "rd",       True,  "1e0caaab-8e36-..."),
    ("rd_mkt_client_secret",   "RD MKT · Client Secret",      "rd",       True,  "d16a9e739cc..."),

    # NIBO (informativo — tokens reais ficam em env vars do Vercel)
    ("nibo_company_imoveis",   "NIBO · CNPJ Imóveis (display)","nibo",    False, "50.741.349/0001-52"),
    ("nibo_company_locacao",   "NIBO · CNPJ Locação (display)","nibo",    False, "45.078.081/0001-80"),

    # IAs
    ("openai_api_key",         "OpenAI · API Key",            "ai",       True,  "sk-..."),
    ("anthropic_api_key",      "Anthropic Claude · API Key",  "ai",       True,  "sk-ant-..."),
    ("gemini_api_key",         "Google Gemini · API Key",     "ai",       True,  "AIza..."),
    ("nano_banana_key",        "Nano Banana · API Key",       "ai",       True,  ""),
    ("vera_notebook_url",      "Vera · URL NotebookLM",       "ai",       False, "https://notebooklm..."),

    # Storage
    ("notion_key",             "Notion · Integration Secret", "storage",  True,  "secret_..."),
    ("notion_db",              "Notion · Database ID",        "storage",  False, ""),
    ("google_drive_folder",    "Google Drive · Folder ID",    "storage",  False, ""),
    ("google_sheets_id",       "Google Sheets · ID",          "storage",  False, ""),

    # Comunicação
    ("whatsapp_number",        "WhatsApp · Número grupo",     "comm",     False, "5517999999999"),
    ("webhook_url",            "Webhook · URL alertas",       "comm",     False, "https://hook.zapier..."),
]

CATEGORIES = {
    "rd":      {"label": "RD Station",     "ico": "🔗"},
    "nibo":    {"label": "NIBO",           "ico": "💰"},
    "ai":      {"label": "IA & APIs",      "ico": "🤖"},
    "storage": {"label": "Storage & Docs", "ico": "📦"},
    "comm":    {"label": "Comunicação",    "ico": "📲"},
}


def whitelist():
    """Retorna set de chaves válidas."""
    return {k for k, _l, _c, _s, _p in SETTINGS_SCHEMA}


def is_secret(key: str) -> bool:
    for k, _l, _c, sec, _p in SETTINGS_SCHEMA:
        if k == key:
            return sec
    return True  # default seguro


def mask(value: str) -> str:
    """Mascara secrets pra exibição."""
    if not value: return ""
    if len(value) <= 8: return "•" * len(value)
    return value[:4] + "•" * (len(value) - 8) + value[-4:]


def to_grouped(stored: dict) -> list:
    """Converte dict de valores em lista agrupada por categoria pra UI."""
    groups = {}
    for k, label, cat, sec, placeholder in SETTINGS_SCHEMA:
        groups.setdefault(cat, {"category": cat, **CATEGORIES.get(cat, {}), "items": []})
        val = stored.get(k) or ""
        groups[cat]["items"].append({
            "key": k,
            "label": label,
            "is_secret": sec,
            "placeholder": placeholder,
            "value": mask(val) if sec else val,
            "has_value": bool(val),
        })
    return list(groups.values())
