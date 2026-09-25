FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
COPY reports /app/reports
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY src ./src
COPY data ./data
COPY --from=web-build /app/web/dist ./static
RUN pip install --no-cache-dir ".[neo4j]"
ENV SCRIPTGRAPH_DEMO_MODE=true
EXPOSE 8000
CMD ["uvicorn", "scriptgraph.api:app", "--host", "0.0.0.0", "--port", "8000"]
