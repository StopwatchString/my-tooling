#include "SubComponent.hpp"

#include <iostream>

namespace Namespace {

SubComponent::SubComponent()
    : printCount(0)
{

}

SubComponent::~SubComponent()
{

}

void SubComponent::print()
{
    std::cout << "Hello SubComponent" << std::endl;
    printCount++;
}

int SubComponent::getPrintCount()
{
    return printCount;
}

}