ARG LAMBDA_BASE_REPO=public.ecr.aws/lambda/nodejs
ARG LAMBDA_BASE_TAG=22
FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG} AS pybuild
RUN dnf install -y python3.11 python3.11-pip gcc gcc-c++ make && dnf clean all
RUN python3.11 -m pip install --target /opt/py-packages code-review-graph drain3
FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG}
RUN dnf install -y python3.11 git && dnf clean all
COPY --from=pybuild /opt/py-packages /opt/py-packages
ENV PYTHONPATH=/opt/py-packages
RUN npm install -g @anthropic-ai/claude-code@2.1.131
RUN python3.11 - <<'PY'
import drain3; print("drain3 OK")
import code_review_graph; print("crg import OK")
import pkgutil
print("crg submodules:", [m.name for m in pkgutil.iter_modules(code_review_graph.__path__)])
PY
