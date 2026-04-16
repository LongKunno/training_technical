from fastapi import FastAPI

app = FastAPI(
    title="Data Pipeline Service", 
    description="Python Crawler & Background Worker API",
    version="1.0.0"
)

@app.get("/health")
async def health_check():
    return {
        "status": "ok", 
        "service": "Data Pipeline (Python)",
        "message": "Sẵn sàng hoạt động, đang hứng dữ liệu từ sàn Crypto!"
    }
