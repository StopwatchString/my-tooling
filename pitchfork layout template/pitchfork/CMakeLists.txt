cmake_minimum_required(VERSION 3.30)

# Globals
set(PROJECT_NAME "ProjectName")
set(TARGET_NAME "TargetName")

# Environment settings
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# CPP
set(SOURCES
    ${CMAKE_SOURCE_DIR}/src/main.cpp
    ${CMAKE_SOURCE_DIR}/src/Component.cpp
    ${CMAKE_SOURCE_DIR}/src/namespace/SubComponent.cpp
)
set(PRIVATE_HEADERS
    ${CMAKE_SOURCE_DIR}/src/Component.hpp
    ${CMAKE_SOURCE_DIR}/src/namespace/SubComponent.hpp
)
set(PUBLIC_HEADERS
    #${CMAKE_SOURCE_DIR}/include
)

project(${PROJECT_NAME})

add_executable(${TARGET_NAME} ${SOURCES} ${PRIVATE_HEADERS} ${PUBLIC_HEADERS})

# All headers in /src are private
target_include_directories(${TARGET_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/src)
# All headers in /include are public
target_include_directories(${TARGET_NAME} PUBLIC ${CMAKE_SOURCE_DIR}/include)

# Provides folder tree in visual studio filters
source_group(TREE ${CMAKE_SOURCE_DIR}/src PREFIX "Source Files" FILES ${SOURCES})
source_group(TREE ${CMAKE_SOURCE_DIR}/src PREFIX "Header Files" FILES ${PRIVATE_HEADERS})
source_group(TREE ${CMAKE_SOURCE_DIR}/include PREFIX "Public Header Files" FILES ${PUBLIC_HEADERS})
