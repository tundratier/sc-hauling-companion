FROM python:3.13.9-alpine
WORKDIR /work
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0
# Phase 1 needs the standard library only; numpy is added with the MDS step (phase 2).
ENTRYPOINT ["python", "-I", "/work/tools/terminal-map/compile.py"]
