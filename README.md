k8s-run
======================
Run a pod that mirrors a deployment but without resource constraints and readiness probes. Drops you into a shell
and removes the pod when you finish.

This modifies the deployment by:

1. Turning it into a pod
2. Removing metadata.labels.app
3. Modifying the name to add -(username)