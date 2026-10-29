FROM python:3.13.9-alpine
WORKDIR /work
# Single-threaded BLAS and a fixed hash seed: same input, same bytes (docs/terminal-map.md §4.3)
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
COPY tools/terminal-map/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
ENTRYPOINT ["python", "-I", "/work/tools/terminal-map/compile.py"]
