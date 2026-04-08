from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from export_ppt import build_pptx_bytes


class BackgroundImage(BaseModel):
    url: str
    x: float = 0
    y: float = 0
    width: float
    height: float


class TextNode(BaseModel):
    text: str
    x: float
    y: float
    width: float
    height: float
    fontSize: float = Field(..., alias="fontSize")
    fontWeight: float = Field(..., alias="fontWeight")
    color: str
    fontFamily: str = Field(..., alias="fontFamily")
    role: str


class Slide(BaseModel):
    slideIndex: int = Field(..., alias="slideIndex")
    width: float
    height: float
    backgroundImage: BackgroundImage = Field(..., alias="backgroundImage")
    textNodes: list[TextNode] = Field(default_factory=list, alias="textNodes")


class ExportPayload(BaseModel):
    slides: list[Slide]


app = FastAPI(title="Flow2Go PPT Export Service", version="0.1.0")

# Local dev: allow Flow2Go Vite origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/ppt/export")
def export_ppt(payload: ExportPayload):
    pptx_bytes = build_pptx_bytes(payload.model_dump(by_alias=True))
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": 'attachment; filename="flow2go.pptx"'},
    )


@app.get("/health")
def health():
    return {"ok": True}

