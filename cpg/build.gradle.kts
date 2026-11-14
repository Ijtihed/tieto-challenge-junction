// Schema CPG sidecar — wraps Fraunhofer-AISEC's Code Property Graph library.
// Build: ./gradlew installDist
// Run:   ./build/install/schema-cpg/bin/schema-cpg --http 7475
plugins {
    kotlin("jvm") version "2.0.21"
    application
}

group = "dev.schema"
version = "0.1.0"

repositories {
    mavenCentral()
}

val cpgVersion = "9.0.2"

dependencies {
    implementation("de.fraunhofer.aisec:cpg-core:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-language-java:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-language-go:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-language-python:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-language-cxx:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-language-ruby:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-language-typescript:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-language-llvm:$cpgVersion")
    implementation("de.fraunhofer.aisec:cpg-analysis:$cpgVersion")

    testImplementation(kotlin("test"))
}

application {
    mainClass.set("dev.schema.cpg.MainKt")
}

kotlin {
    jvmToolchain(21)
}

tasks.test {
    useJUnitPlatform()
}
