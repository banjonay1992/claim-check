from fastapi import FastAPI

app = FastAPI()

@app.delete("/items/{item_id}")
def remove(item_id: int):
    return {}
