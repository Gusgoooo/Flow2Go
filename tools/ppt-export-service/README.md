# Flow2Go PPT Export Service (python-pptx)

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 9007
```

Health check: `GET /health`  
Export: `POST /api/ppt/export`

## Notes

- MVP 仅支持 `backgroundImage.url` 为 `data:image/*;base64,...`。
- 画布坐标按 payload 的 `width/height` 等比映射到 PPT 16:9 页面。

