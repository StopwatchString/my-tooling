#include "Component.hpp"

#include <iostream>

Component::Component()
    : printCount(0)
{

}

Component::~Component()
{

}

void Component::print()
{
    std::cout << "Hello Component" << std::endl;
    printCount++;
}

int Component::getPrintCount()
{
    return printCount;
}
