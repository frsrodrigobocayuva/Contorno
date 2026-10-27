# GraphHopper a partir do jar oficial (Maven Central), sobre JRE 21 (exige Java 17 ou mais).
FROM eclipse-temurin:21.0.12_8-jre-noble
ARG GRAPHHOPPER_VERSION=11.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /opt/graphhopper.jar \
       "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/${GRAPHHOPPER_VERSION}/graphhopper-web-${GRAPHHOPPER_VERSION}.jar"
COPY config.yml /opt/config.yml
EXPOSE 8989
ENTRYPOINT ["java", "-Xmx1g", "-jar", "/opt/graphhopper.jar", "server", "/opt/config.yml"]
